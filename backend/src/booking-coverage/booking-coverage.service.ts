import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
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
import { assertCoverageInterval, assertDelegate, assertNoOverlappingCoverage, createCoverage } from './coverage-commands';
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

  async requestCoverage(bookingId: string, actor: { id: string; role: string }, dto: CreateTemporaryCoverageDto) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking) throw new NotFoundException('Không tìm thấy booking.');
      if (actor.role !== 'ADMIN') {
        const staff = await requireActiveStaff(em, booking.hotelId, actor.id);
        const isMgr = staff.staffRole === 'MANAGER';
        if (!isMgr && String(booking.handledBy) !== String(actor.id)) {
          throw new ForbiddenException('Chỉ nhân viên phụ trách đơn (A) hoặc Quản lý mới có quyền khởi tạo đề nghị hỗ trợ.');
        }
        if (isMgr) {
          return createCoverage(em, bookingId, actor, { ...dto, requireDelegateAcceptance: true });
        }
      } else {
        return createCoverage(em, bookingId, actor, { ...dto, requireDelegateAcceptance: true });
      }

      const start = new Date(dto.startAt), end = new Date(dto.endAt);
      await assertCoverageInterval(em, booking, start, end, dto.absenceRequestId);
      if (end <= new Date() || String(booking.handledBy) === dto.delegateStaffUserId) {
        throw new BadRequestException('Người hỗ trợ phải khác chủ booking; thời hạn chưa kết thúc.');
      }
      await assertDelegate(em, booking, dto.delegateStaffUserId, start, end);
      const mode = dto.scopeMode || 'BOOKING_TASKS';
      const taskIds = [...new Set(dto.taskIds || [])];
      const deadline = dto.completionDeadline ? new Date(dto.completionDeadline) : end;
      await assertNoOverlappingCoverage(em, bookingId, start, end, mode, dto.allowedTaskTypes || [], taskIds);

      const grant = await em.save(BookingCoverageGrant, em.create(BookingCoverageGrant, {
        bookingId, hotelId: booking.hotelId, principalStaffId: booking.handledBy!, delegateStaffId: dto.delegateStaffUserId,
        mode: 'TEMPORARY', scopeMode: mode, absenceRequestId: dto.absenceRequestId || null,
        startAt: start, endAt: end, completionDeadline: deadline, allowedTaskTypes: dto.allowedTaskTypes || [],
        status: CoverageGrantStatus.REQUESTED, createdBy: actor.id, requestedBy: actor.id,
        reason: dto.reason || 'Nhân viên phụ trách đề nghị bàn giao tạm thời', commandKey: dto.commandId || null, version: 1,
      }));
      for (const id of taskIds) {
        await em.query('INSERT INTO booking_coverage_task_scopes(grant_id,task_id) VALUES (?,?)', [grant.id, id]);
      }
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_REQUESTED,
        newValue: { status: CoverageGrantStatus.REQUESTED, delegateStaffId: dto.delegateStaffUserId, scopeMode: mode },
        note: dto.reason || null,
      }));
      return grant;
    });
  }

  async approveCoverage(bookingId: string, grantId: string, actor: { id: string; role: string }, note?: string) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking || !grant) throw new NotFoundException(`Không tìm thấy yêu cầu hỗ trợ #${grantId}`);
      await requireManager(em, booking.hotelId, actor);
      if (grant.status === CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE) return grant;
      if (grant.status !== CoverageGrantStatus.REQUESTED) {
        throw new ConflictException(`Chỉ có thể duyệt yêu cầu ở trạng thái REQUESTED (hiện tại: ${grant.status}).`);
      }
      await assertNoOverlappingCoverage(
        em, bookingId, new Date(grant.startAt), new Date(grant.endAt),
        grant.scopeMode || 'TASK_TYPES', grant.allowedTaskTypes || [], [], grant.id,
      );
      const now = new Date();
      grant.status = CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE;
      grant.approvedBy = actor.id;
      grant.approvedAt = now;
      grant.acceptDeadline = new Date(Math.min(new Date(grant.endAt).getTime(), Math.max(new Date(grant.startAt).getTime(), now.getTime() + 30 * 60000)));
      grant.version += 1;
      const saved = await em.save(BookingCoverageGrant, grant);
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_APPROVED,
        newValue: { status: saved.status, approvedBy: actor.id }, note: note || 'Quản lý phê duyệt yêu cầu bàn giao, chờ B xác nhận',
      }));
      this.notify(booking.hotelId, bookingId, `Yêu cầu hỗ trợ đơn #${bookingId} đã được duyệt, chờ nhân sự #${grant.delegateStaffId} xác nhận.`);
      return saved;
    });
  }

  async acceptCoverage(bookingId: string, grantId: string, actor: { id: string; role: string }, note?: string) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking || !grant) throw new NotFoundException(`Không tìm thấy yêu cầu hỗ trợ #${grantId}`);
      if (String(grant.delegateStaffId) !== String(actor.id) && actor.role !== 'ADMIN') {
        throw new ForbiddenException('Chỉ nhân sự B được chỉ định mới có quyền ký nhận bàn giao này.');
      }
      if ([CoverageGrantStatus.ACTIVE, CoverageGrantStatus.SCHEDULED].includes(grant.status) && grant.acceptedAt) {
        return grant;
      }
      if (grant.status !== CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE) {
        throw new ConflictException(`Yêu cầu hỗ trợ phải được Quản lý duyệt trước khi ký nhận (hiện tại: ${grant.status}).`);
      }
      const now = new Date();
      if (new Date(grant.endAt) <= now) {
        throw new ConflictException('Khoảng thời gian hỗ trợ đã kết thúc, không thể nhận bàn giao.');
      }
      await assertDelegate(em, booking, grant.delegateStaffId, new Date(grant.startAt), new Date(grant.endAt));
      await assertNoOverlappingCoverage(
        em, bookingId, new Date(grant.startAt), new Date(grant.endAt),
        grant.scopeMode || 'TASK_TYPES', grant.allowedTaskTypes || [], [], grant.id,
      );
      grant.acceptedBy = actor.id;
      grant.acceptedAt = now;
      grant.status = new Date(grant.startAt) <= now ? CoverageGrantStatus.ACTIVE : CoverageGrantStatus.SCHEDULED;
      grant.version += 1;
      const saved = await em.save(BookingCoverageGrant, grant);
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_ACCEPTED,
        newValue: { status: saved.status, acceptedBy: actor.id, acceptedAt: now.toISOString() },
        note: note || 'Nhân sự hỗ trợ B đã xác nhận nhận bàn giao',
      }));
      this.notify(booking.hotelId, bookingId, `Nhân sự #${grant.delegateStaffId} đã ký nhận hỗ trợ đơn #${bookingId}.`);
      return saved;
    });
  }

  async declineCoverage(bookingId: string, grantId: string, actor: { id: string; role: string }, reason?: string) {
    return this.dataSource.transaction(async (em) => {
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!grant) throw new NotFoundException(`Không tìm thấy yêu cầu hỗ trợ #${grantId}`);
      if (String(grant.delegateStaffId) !== String(actor.id) && actor.role !== 'ADMIN') {
        throw new ForbiddenException('Chỉ nhân sự B được chỉ định mới có thể từ chối nhận bàn giao.');
      }
      if (![CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE, CoverageGrantStatus.REQUESTED].includes(grant.status)) {
        throw new ConflictException(`Không thể từ chối yêu cầu ở trạng thái ${grant.status}.`);
      }
      grant.status = CoverageGrantStatus.DECLINED;
      grant.version += 1;
      const saved = await em.save(BookingCoverageGrant, grant);
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_DECLINED,
        newValue: { status: CoverageGrantStatus.DECLINED, reason: reason || 'Nhân sự B từ chối nhận bàn giao' },
        note: reason || 'Nhân sự B từ chối nhận bàn giao',
      }));
      this.notify(grant.hotelId, bookingId, `[CẢNH BÁO] Nhân sự #${actor.id} từ chối nhận hỗ trợ đơn #${bookingId}. Cần Quản lý điều phối ngay.`);
      return saved;
    });
  }

  async handbackCoverage(bookingId: string, grantId: string, actor: { id: string; role: string }, reason?: string) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking || !grant) throw new NotFoundException(`Không tìm thấy quyền hỗ trợ #${grantId}`);
      await requireManager(em, grant.hotelId, actor);
      const now = new Date();
      if (booking.handledBy) {
        const [activeBlock] = await em.query(
          `SELECT id FROM staff_availability_blocks WHERE hotel_id = ? AND staff_user_id = ? AND active = 1 AND start_at <= ? AND end_at > ? LIMIT 1`,
          [grant.hotelId, booking.handledBy, now, now],
        );
        if (activeBlock) {
          throw new ConflictException('STAFF_ABSENT: Nhân sự chính A vẫn đang trong khoảng nghỉ phép/vắng mặt, chưa thể hoàn trả quyền.');
        }
      }
      grant.status = CoverageGrantStatus.REVOKED;
      grant.endAt = now;
      grant.version += 1;
      const saved = await em.save(BookingCoverageGrant, grant);
      const tasks = await em.getRepository(GuestWorkTask).createQueryBuilder('t').setLock('pessimistic_write')
        .where('t.booking_id = :bookingId AND (t.coverage_grant_id = :grantId OR t.active_executor_id = :delegateId)', {
          bookingId, grantId, delegateId: grant.delegateStaffId,
        }).orderBy('t.id', 'ASC').getMany();
      for (const task of tasks) {
        if (![WorkTaskStatus.ASSIGNED, WorkTaskStatus.ACCEPTED, WorkTaskStatus.IN_PROGRESS].includes(task.status)) continue;
        const fromStatus = task.status;
        task.assignedStaffId = booking.handledBy || task.assignedStaffId;
        task.activeExecutorId = booking.handledBy || null;
        task.coverageGrantId = null;
        task.executionLeaseUntil = null;
        if (task.status !== WorkTaskStatus.ASSIGNED) task.status = WorkTaskStatus.ASSIGNED;
        task.version += 1;
        await em.save(GuestWorkTask, task);
        await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
          taskId: task.id, bookingId, hotelId: grant.hotelId, actorType: 'USER', actorStaffId: actor.id,
          eventType: WorkEventType.TASK_HANDOVER_REQUIRED, fromStatus, toStatus: task.status, occurredAt: now,
          evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: `HANDBACK_TO_PRINCIPAL:${grant.id}->${booking.handledBy}`,
        }));
      }
      await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
        grantId: grant.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_HANDBACK,
        newValue: { status: CoverageGrantStatus.REVOKED, handbackTo: booking.handledBy },
        note: reason || 'Hoàn trả quyền xử lý về nhân viên phụ trách chính A',
      }));
      return saved;
    });
  }

  async extend(bookingId: string, grantId: string, actor: { id: string; role: string }, dto: ExtendCoverageDto) {
    return this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      const grant = await em.findOne(BookingCoverageGrant, { where: { id: grantId, bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking || !grant) throw new NotFoundException(`Không tìm thấy quyền hỗ trợ #${grantId}`);
      if (String(grant.hotelId) !== String(booking.hotelId) || ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId))) {
        throw new ForbiddenException('hotelId không khớp với khách sạn thực tế của đơn đặt phòng.');
      }
      await requireManager(em, booking.hotelId, actor);
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
      // Kích hoạt các grant SCHEDULED đã được B accept khi đến startAt
      const dueToStart = await em.getRepository(BookingCoverageGrant).createQueryBuilder('g').setLock('pessimistic_write')
        .where("g.status = 'SCHEDULED' AND g.start_at <= :now AND g.end_at > :now", { now }).orderBy('g.id', 'ASC').getMany();
      for (const g of dueToStart) {
        g.status = CoverageGrantStatus.ACTIVE;
        g.version += 1;
        await em.save(BookingCoverageGrant, g);
      }

      const overdue = await em.getRepository(BookingCoverageGrant).createQueryBuilder('g').setLock('pessimistic_write')
        .where("g.status IN ('ACTIVE', 'SCHEDULED', 'APPROVED_PENDING_ACCEPTANCE') AND g.end_at <= :now", { now })
        .orderBy('g.id', 'ASC').getMany();
      for (const grant of overdue) {
        grant.status = CoverageGrantStatus.EXPIRED; grant.version += 1;
        await em.save(BookingCoverageGrant, grant);

        // P1-26: Xử lý các task đang mở của B khi grant hết hạn (tránh kẹt activeExecutorId)
        const openTasks = await em.getRepository(GuestWorkTask).createQueryBuilder('t').setLock('pessimistic_write')
          .where('t.booking_id = :bookingId AND (t.coverage_grant_id = :grantId OR t.active_executor_id = :delegateId)', {
            bookingId: grant.bookingId, grantId: grant.id, delegateId: grant.delegateStaffId,
          }).orderBy('t.id', 'ASC').getMany();
        for (const task of openTasks) {
          if (![WorkTaskStatus.ACCEPTED, WorkTaskStatus.IN_PROGRESS].includes(task.status)) continue;
          if (task.executionLeaseUntil && new Date(task.executionLeaseUntil) > now) continue;
          const fromStatus = task.status;
          const prevExecutor = task.activeExecutorId;
          task.status = WorkTaskStatus.ASSIGNED;
          task.activeExecutorId = null;
          task.coverageGrantId = null;
          task.executionLeaseUntil = null;
          task.version += 1;
          await em.save(GuestWorkTask, task);
          await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
            taskId: task.id, bookingId: grant.bookingId, hotelId: grant.hotelId,
            actorType: 'SYSTEM', actorStaffId: null,
            eventType: WorkEventType.TASK_HANDOVER_REQUIRED,
            fromStatus, toStatus: task.status, occurredAt: now,
            evidenceType: WorkEvidenceType.SYSTEM_LOG,
            evidenceRef: `EXPIRE_GRANT:${grant.id}:${prevExecutor || 'none'}`,
          }));
        }

        await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
          grantId: grant.id, bookingId: grant.bookingId, eventType: CoverageEventType.GRANT_EXPIRED,
          actorId: null, note: 'Quyền hỗ trợ tạm thời tự động hết hạn và thu hồi nhiệm vụ dở dang',
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
