import {
  BadRequestException, ConflictException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingAssignment } from '../booking-assignment/entities/booking-assignment.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskStatus } from '../guest-work/entities/guest-work-task.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { assertCoverageInterval, assertDelegate, createCoverage } from './coverage-commands';
import { findCoverage, requireActiveStaff, requireManager } from './coverage-policy';
import { CreateTemporaryCoverageDto } from './dto/create-temporary-coverage.dto';
import { ExtendCoverageDto } from './dto/extend-coverage.dto';
import { PermanentTransferDto } from './dto/permanent-transfer.dto';
import { BookingCoverageEvent, CoverageEventType } from './entities/booking-coverage-event.entity';
import { BookingCoverageGrant, CoverageGrantStatus, CoverageTaskType } from './entities/booking-coverage-grant.entity';
import { executePermanentTransfer } from './permanent-transfer';

@Injectable()
export class BookingCoverageService {
  constructor(
    @InjectRepository(BookingCoverageGrant) private readonly grantRepo: Repository<BookingCoverageGrant>,
    @InjectRepository(BookingCoverageEvent) private readonly eventRepo: Repository<BookingCoverageEvent>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingAssignment) private readonly assignmentRepo: Repository<BookingAssignment>,
    @InjectRepository(BookingAssignmentState) private readonly stateRepo: Repository<BookingAssignmentState>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    private readonly dataSource: DataSource,
    @Optional() private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async createTemporary(bookingId: string, actor: { id: string; role: string }, dto: CreateTemporaryCoverageDto) {
    const saved = await this.dataSource.transaction((em) => createCoverage(em, bookingId, actor, dto));
    this.notify(saved.hotelId, bookingId, `Đơn #${bookingId} đã cấp hỗ trợ tạm cho #${dto.delegateStaffUserId}`);
    return saved;
  }

  async extend(bookingId: string, grantId: string, actor: { id: string; role: string }, dto: ExtendCoverageDto) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking || !grant) throw new NotFoundException(`Không tìm thấy quyền hỗ trợ #${grantId}`);
      await requireManager(em, grant.hotelId, actor);
      if (grant.status !== CoverageGrantStatus.ACTIVE) throw new ConflictException('Quyền hỗ trợ không còn ACTIVE.');
      if (Number(grant.version) !== Number(dto.expectedVersion)) throw new ConflictException('Phiên bản quyền hỗ trợ đã thay đổi.');
      const newEnd = new Date(dto.newEndAt);
      if (!Number.isFinite(newEnd.getTime()) || newEnd <= new Date(grant.endAt)) throw new BadRequestException('newEndAt phải sau endAt hiện tại.');
      await assertCoverageInterval(em, booking, new Date(grant.startAt), newEnd, grant.absenceRequestId);
      await assertDelegate(em, booking, grant.delegateStaffId, new Date(grant.endAt), newEnd);
      const oldEnd = grant.endAt;
      grant.endAt = newEnd;
      if (!grant.completionDeadline || new Date(grant.completionDeadline) < newEnd) grant.completionDeadline = newEnd;
      grant.version += 1;
      const updated = await em.save(BookingCoverageGrant, grant);
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, eventType: CoverageEventType.GRANT_EXTENDED, actorId: actor.id,
        oldValue: { endAt: oldEnd }, newValue: { endAt: newEnd, reason: dto.reason }, note: dto.reason,
      }));
      return updated;
    });
  }

  async revoke(bookingId: string, grantId: string, actor: { id: string; role: string }, reason?: string) {
    return this.dataSource.transaction(async (em) => {
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!grant) throw new NotFoundException(`Không tìm thấy quyền hỗ trợ #${grantId}`);
      await requireManager(em, grant.hotelId, actor);
      if (grant.status !== CoverageGrantStatus.ACTIVE) throw new ConflictException('Quyền hỗ trợ không còn ACTIVE.');
      const now = new Date();
      grant.status = CoverageGrantStatus.REVOKED;
      grant.version += 1;
      const updated = await em.save(BookingCoverageGrant, grant);
      const tasks = await em.getRepository(GuestWorkTask).createQueryBuilder('t').setLock('pessimistic_write')
        .where('t.coverage_grant_id = :grantId', { grantId }).orderBy('t.id', 'ASC').getMany();
      for (const task of tasks) {
        if (![WorkTaskStatus.ACCEPTED, WorkTaskStatus.IN_PROGRESS].includes(task.status)) continue;
        const fromStatus = task.status, prevExecutor = task.activeExecutorId;
        task.status = WorkTaskStatus.ASSIGNED; task.startedAt = null;
        task.activeExecutorId = null; task.coverageGrantId = null; task.executionLeaseUntil = null; task.version += 1;
        await em.save(GuestWorkTask, task);
        await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
          taskId: task.id, bookingId, hotelId: grant.hotelId, actorType: 'USER', actorStaffId: actor.id,
          eventType: WorkEventType.TASK_HANDOVER_REQUIRED, fromStatus, toStatus: task.status, occurredAt: now,
          evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: `REVOKE_GRANT:${grant.id}:${prevExecutor || 'none'}`,
        }));
      }
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, eventType: CoverageEventType.GRANT_REVOKED, actorId: actor.id,
        newValue: { status: CoverageGrantStatus.REVOKED, reason: reason || 'Quản lý thu hồi' }, note: reason || null,
      }));
      return updated;
    });
  }

  async transferPermanent(bookingId: string, actor: { id: string; role: string }, dto: PermanentTransferDto) {
    const res = await this.dataSource.transaction((em) => executePermanentTransfer(em, bookingId, actor, dto));
    this.notify(res.booking.hotelId, bookingId, `Đơn #${bookingId} đã chuyển chủ chính sang #${dto.toStaffUserId}`);
    return res;
  }

  async isStaffCoveringTask(bookingId: string, staffId: string, taskType: CoverageTaskType | string, at = new Date(), taskId?: string) {
    return Boolean(await findCoverage(this.grantRepo.manager, bookingId, staffId, String(taskType), at, taskId));
  }

  async getCoverageTimeline(bookingId: string, actor?: { id: string; role: string }) {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    if (actor) await assertBookingOperator(this.bookingRepo.manager, booking, actor);
    const [grants, events] = await Promise.all([
      this.grantRepo.find({ where: { bookingId }, order: { createdAt: 'DESC' } }),
      this.eventRepo.find({ where: { bookingId }, order: { occurredAt: 'DESC' } }),
    ]);
    if (actor?.role === 'CUSTOMER') {
      return {
        grants: grants.map((g) => ({ ...g, reason: null, commandKey: null, createdBy: '' as any, absenceRequestId: null })),
        events: events.map((e) => ({ ...e, note: null, oldValue: null, newValue: null, actorId: null })),
      };
    }
    return { grants, events };
  }

  async getActiveGrantsForHotel(hotelId: string, actor?: { id: string; role: string }) {
    if (actor && actor.role !== 'ADMIN') await requireActiveStaff(this.grantRepo.manager, hotelId, actor.id);
    const now = new Date();
    return this.grantRepo.find({
      where: { hotelId, status: CoverageGrantStatus.ACTIVE, startAt: LessThanOrEqual(now), endAt: MoreThan(now) },
      order: { endAt: 'ASC' },
    });
  }

  async expireOverdueGrants(): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const now = new Date();
      const overdue = await em.getRepository(BookingCoverageGrant).createQueryBuilder('g').setLock('pessimistic_write')
        .where("g.status = 'ACTIVE' AND g.end_at <= :now", { now }).orderBy('g.id', 'ASC').getMany();
      for (const grant of overdue) {
        grant.status = CoverageGrantStatus.EXPIRED; grant.version += 1;
        await em.save(BookingCoverageGrant, grant);
        await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
          grantId: grant.id, bookingId: grant.bookingId, eventType: CoverageEventType.GRANT_EXPIRED,
          actorId: null, note: 'Quyền hỗ trợ tạm thời tự động hết hạn',
        }));
      }
      return overdue.length;
    });
  }

  private notify(hotelId: string, bookingId: string, message: string) {
    try {
      this.realtimeGateway?.emitSystemNotification({
        id: randomUUID(), title: 'Điều phối phụ trách', message, type: 'info',
        timestamp: new Date().toISOString(), data: { hotelId, targetRole: 'STAFF', bookingId },
      });
    } catch {}
  }
}
