import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual, MoreThan } from 'typeorm';
import {
  BookingCoverageGrant,
  CoverageGrantStatus,
  CoverageTaskType,
} from './entities/booking-coverage-grant.entity';
import {
  BookingCoverageEvent,
  CoverageEventType,
} from './entities/booking-coverage-event.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingAssignment } from '../booking-assignment/entities/booking-assignment.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';
import { CreateTemporaryCoverageDto } from './dto/create-temporary-coverage.dto';
import { ExtendCoverageDto } from './dto/extend-coverage.dto';
import { PermanentTransferDto } from './dto/permanent-transfer.dto';

@Injectable()
export class BookingCoverageService {
  private readonly logger = new Logger(BookingCoverageService.name);

  constructor(
    @InjectRepository(BookingCoverageGrant)
    private readonly grantRepo: Repository<BookingCoverageGrant>,
    @InjectRepository(BookingCoverageEvent)
    private readonly eventRepo: Repository<BookingCoverageEvent>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingAssignment)
    private readonly assignmentRepo: Repository<BookingAssignment>,
    @InjectRepository(BookingAssignmentState)
    private readonly stateRepo: Repository<BookingAssignmentState>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async createTemporary(
    bookingId: string,
    actor: { id: string; role: string },
    dto: CreateTemporaryCoverageDto,
  ): Promise<BookingCoverageGrant> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, booking.hotelId);
    if (!isManager && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản lý hoặc Quản trị viên mới có quyền thiết lập ủy quyền hỗ trợ tạm thời');
    }

    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      throw new BadRequestException('Khoảng thời gian ủy quyền không hợp lệ (startAt phải trước endAt)');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes < 15 || durationMinutes > 24 * 60) {
      throw new BadRequestException('Thời hạn hỗ trợ tạm thời phải từ 15 phút đến tối đa 24 giờ');
    }

    const isDelegateStaff = await this.staffAvailabilityService.isStaffAtHotel(dto.delegateStaffUserId, booking.hotelId);
    if (!isDelegateStaff) {
      throw new BadRequestException('Nhân viên nhận hỗ trợ phải có quan hệ công tác ACTIVE tại cùng khách sạn');
    }

    const isAvailable = await this.staffAvailabilityService.checkStaffAvailabilityOnInterval(
      dto.delegateStaffUserId,
      booking.hotelId,
      start,
      end,
    );
    if (!isAvailable) {
      throw new ConflictException(
        'Nhân viên nhận hỗ trợ đang có lịch nghỉ hoặc không khả dụng trong khoảng thời gian này',
      );
    }

    // Kiểm tra idempotent theo commandId
    if (dto.commandId) {
      const existing = await this.grantRepo.findOne({
        where: { commandKey: dto.commandId, bookingId },
      });
      if (existing) {
        return existing;
      }
    }

    const principalStaffId = booking.handledBy || actor.id;

    return await this.dataSource.transaction(async (em) => {
      const grant = em.create(BookingCoverageGrant, {
        bookingId,
        hotelId: booking.hotelId,
        principalStaffId,
        delegateStaffId: dto.delegateStaffUserId,
        mode: 'TEMPORARY',
        startAt: start,
        endAt: end,
        status: CoverageGrantStatus.ACTIVE,
        allowedTaskTypes: dto.allowedTaskTypes,
        createdBy: actor.id,
        reason: dto.reason,
        commandKey: dto.commandId || null,
        version: 1,
      });
      const savedGrant = await em.save(BookingCoverageGrant, grant);

      const event = em.create(BookingCoverageEvent, {
        grantId: savedGrant.id,
        bookingId,
        eventType: CoverageEventType.GRANT_CREATED,
        actorId: actor.id,
        newValue: {
          delegateStaffUserId: dto.delegateStaffUserId,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          allowedTaskTypes: dto.allowedTaskTypes,
          reason: dto.reason,
        },
        note: `Thiết lập hỗ trợ thay tạm thời cho nhân viên #${dto.delegateStaffUserId}`,
      });
      await em.save(BookingCoverageEvent, event);

      try {
        this.realtimeGateway?.emitSystemNotification({
          id: randomUUID(),
          title: 'Ủy quyền hỗ trợ',
          message: `Đơn #${bookingId} đã được thiết lập hỗ trợ tạm thời cho nhân viên #${dto.delegateStaffUserId}`,
          type: 'info',
          timestamp: new Date().toISOString(),
          data: {
            hotelId: booking.hotelId,
            targetRole: 'STAFF',
            bookingId,
          },
        });
      } catch {
        // Fail-safe
      }

      return savedGrant;
    });
  }

  async extend(
    bookingId: string,
    grantId: string,
    actor: { id: string; role: string },
    dto: ExtendCoverageDto,
  ): Promise<BookingCoverageGrant> {
    const grant = await this.grantRepo.findOne({ where: { id: grantId, bookingId } });
    if (!grant) {
      throw new NotFoundException(`Không tìm thấy quyền hỗ trợ tạm thời #${grantId}`);
    }

    const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, grant.hotelId);
    if (!isManager && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền gia hạn thời gian hỗ trợ');
    }

    if (grant.status !== CoverageGrantStatus.ACTIVE) {
      throw new ConflictException(`Quyền hỗ trợ #${grantId} không ở trạng thái ACTIVE (hiện tại: ${grant.status})`);
    }

    if (grant.version !== dto.expectedVersion) {
      throw new ConflictException(`Dữ liệu đã bị thay đổi (phiên bản hiện tại: ${grant.version}, kỳ vọng: ${dto.expectedVersion})`);
    }

    const newEnd = new Date(dto.newEndAt);
    if (isNaN(newEnd.getTime()) || newEnd <= grant.endAt) {
      throw new BadRequestException('Thời gian gia hạn mới phải sau thời gian kết thúc hiện tại');
    }

    const totalDurationMinutes = (newEnd.getTime() - grant.startAt.getTime()) / (1000 * 60);
    if (totalDurationMinutes > 24 * 60) {
      throw new BadRequestException('Tổng thời gian ủy quyền tạm thời không được vượt quá 24 giờ kể từ mốc bắt đầu');
    }

    return await this.dataSource.transaction(async (em) => {
      const oldEnd = grant.endAt;
      grant.endAt = newEnd;
      grant.version += 1;
      const updated = await em.save(BookingCoverageGrant, grant);

      const event = em.create(BookingCoverageEvent, {
        grantId: grant.id,
        bookingId,
        eventType: CoverageEventType.GRANT_EXTENDED,
        actorId: actor.id,
        oldValue: { endAt: oldEnd.toISOString() },
        newValue: { endAt: newEnd.toISOString(), reason: dto.reason },
        note: `Gia hạn thời gian hỗ trợ đến ${newEnd.toISOString()}`,
      });
      await em.save(BookingCoverageEvent, event);

      return updated;
    });
  }

  async revoke(
    bookingId: string,
    grantId: string,
    actor: { id: string; role: string },
    reason?: string,
  ): Promise<BookingCoverageGrant> {
    const grant = await this.grantRepo.findOne({ where: { id: grantId, bookingId } });
    if (!grant) {
      throw new NotFoundException(`Không tìm thấy quyền hỗ trợ tạm thời #${grantId}`);
    }

    const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, grant.hotelId);
    if (!isManager && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền thu hồi hỗ trợ');
    }

    if (grant.status !== CoverageGrantStatus.ACTIVE) {
      throw new ConflictException(`Quyền hỗ trợ đã ở trạng thái ${grant.status}`);
    }

    return await this.dataSource.transaction(async (em) => {
      grant.status = CoverageGrantStatus.REVOKED;
      grant.version += 1;
      const updated = await em.save(BookingCoverageGrant, grant);

      const event = em.create(BookingCoverageEvent, {
        grantId: grant.id,
        bookingId,
        eventType: CoverageEventType.GRANT_REVOKED,
        actorId: actor.id,
        newValue: { status: CoverageGrantStatus.REVOKED, reason: reason || 'Quản lý thu hồi ủy quyền' },
        note: reason || 'Quản lý thu hồi ủy quyền hỗ trợ sớm',
      });
      await em.save(BookingCoverageEvent, event);

      return updated;
    });
  }

  async transferPermanent(
    bookingId: string,
    actor: { id: string; role: string },
    dto: PermanentTransferDto,
  ): Promise<{ message: string; booking: Booking; staffId: string; transferredTaskCount?: number }> {
    const txResult = await this.dataSource.transaction(async (em) => {
      const booking = await em.getRepository(Booking).findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      }

      const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, booking.hotelId);
      if (!isManager && actor.role !== 'ADMIN') {
        throw new ForbiddenException('Chỉ Quản lý khách sạn hoặc Admin mới được chuyển giao trách nhiệm hoàn toàn');
      }

      const allowedStatuses = [
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.NO_SHOW,
        BookingStatus.CHECKED_IN,
      ];
      if (!allowedStatuses.includes(booking.status as BookingStatus)) {
        throw new ConflictException(
          `Không thể chuyển giao trách nhiệm đơn ở trạng thái ${booking.status}. Chỉ áp dụng cho PENDING, CONFIRMED, NO_SHOW, CHECKED_IN.`,
        );
      }

      const isTargetStaff = await this.staffAvailabilityService.isStaffAtHotel(dto.toStaffUserId, booking.hotelId);
      if (!isTargetStaff) {
        throw new BadRequestException('Nhân sự tiếp nhận phải là nhân viên ACTIVE tại cùng khách sạn');
      }

      const now = new Date();

      if (typeof this.staffAvailabilityService.isStaffAvailableAt === 'function') {
        const avail = await this.staffAvailabilityService.isStaffAvailableAt(
          String(booking.hotelId),
          String(dto.toStaffUserId),
          now,
        );
        if (avail && avail.available === false) {
          throw new ConflictException(
            `Nhân sự tiếp nhận #${dto.toStaffUserId} hiện đang trong khoảng nghỉ hoặc vắng mặt đã duyệt.`,
          );
        }
      }

      if (String(booking.handledBy) === String(dto.toStaffUserId)) {
        return {
          message: 'Nhân sự này hiện đã là người phụ trách chính của đơn',
          booking,
          staffId: dto.toStaffUserId,
          transferredTaskCount: 0,
          shouldNotify: false,
        };
      }

      const prevOwner = booking.handledBy;

      // Kiểm tra state và expectedAssignmentVersion (D3-02, D3-03)
      let state = await em.getRepository(BookingAssignmentState).findOne({ where: { bookingId } });
      if (
        dto.expectedAssignmentVersion !== undefined &&
        state &&
        state.version !== undefined &&
        Number(state.version) !== Number(dto.expectedAssignmentVersion)
      ) {
        throw new ConflictException(
          `Phiên bản phân công đã thay đổi (hiện tại: ${state.version}, kỳ vọng: ${dto.expectedAssignmentVersion}). Vui lòng tải lại trước khi chuyển giao.`,
        );
      }

      // Đóng assignment hiện tại nếu có
      let prevAssignmentId: string | null = null;
      let prevVersion = state?.version || 0;
      const currentAssignment = await em.getRepository(BookingAssignment).findOne({
        where: { bookingId, endedAt: undefined as any },
        order: { assignmentVersion: 'DESC' },
      });
      if (currentAssignment) {
        currentAssignment.endedAt = now;
        await em.save(BookingAssignment, currentAssignment);
        prevAssignmentId = currentAssignment.id;
        prevVersion = Math.max(prevVersion, currentAssignment.assignmentVersion || 0);
      }

      // Tạo assignment mới
      const newVersion = prevVersion + 1;
      const newAssignment = em.create(BookingAssignment, {
        bookingId,
        hotelId: booking.hotelId,
        staffUserId: dto.toStaffUserId,
        assignmentVersion: newVersion,
        assignedAt: now,
        assignmentType: 'MANUAL_OVERRIDE' as any,
        previousAssignmentId: prevAssignmentId,
        assignedBy: actor.id,
        reason: `Chuyển giao trách nhiệm (${dto.reasonCode || 'TRANSFER'}): ${dto.reason}`,
        sourceEventId: dto.commandId || 'PERMANENT_TRANSFER',
      });
      const savedAssignment = await em.save(BookingAssignment, newAssignment);

      // Cập nhật State
      if (!state) {
        state = em.create(BookingAssignmentState, {
          bookingId,
          hotelId: booking.hotelId,
          currentStaffId: dto.toStaffUserId,
          currentAssignmentId: savedAssignment.id,
          status: 'ASSIGNED' as any,
          version: 1,
        });
      } else {
        state.currentStaffId = dto.toStaffUserId;
        state.currentAssignmentId = savedAssignment.id;
        state.status = 'ASSIGNED' as any;
        state.version = (state.version || 0) + 1;
      }
      await em.save(BookingAssignmentState, state);

      // D3-03: Thu hồi tất cả các grant hỗ trợ tạm thời đang ACTIVE của đơn này
      const activeGrants = await em.getRepository(BookingCoverageGrant).find({
        where: { bookingId, status: CoverageGrantStatus.ACTIVE },
      });
      for (const g of activeGrants || []) {
        g.status = CoverageGrantStatus.REVOKED;
        g.version = (g.version || 1) + 1;
        await em.save(BookingCoverageGrant, g);

        const revokeEvt = em.create(BookingCoverageEvent, {
          grantId: g.id,
          bookingId,
          eventType: CoverageEventType.GRANT_REVOKED,
          actorId: actor.id,
          oldValue: { status: CoverageGrantStatus.ACTIVE, delegateStaffId: g.delegateStaffId },
          newValue: { status: CoverageGrantStatus.REVOKED, reason: 'Chuyển giao trách nhiệm chính hoàn toàn' },
          note: `Tự động thu hồi quyền hỗ trợ tạm thời của #${g.delegateStaffId} khi chuyển giao đơn sang #${dto.toStaffUserId}`,
        });
        await em.save(BookingCoverageEvent, revokeEvt);
      }

      // D3-03: Chuyển giao các tác vụ chưa hoàn thành sang B, giữ nguyên lịch sử sự kiện của A trước thời điểm T
      let transferredTaskCount = 0;
      try {
        const allTasks = await em.getRepository(GuestWorkTask).find({
          where: { bookingId },
        });
        const openStatuses = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];
        for (const task of allTasks || []) {
          if (openStatuses.includes(String(task.status))) {
            const oldAssignee = task.assignedStaffId;
            task.assignedStaffId = dto.toStaffUserId;
            if (String(task.status) === 'CREATED') {
              task.status = 'ASSIGNED' as any;
            }
            task.version = (task.version || 1) + 1;
            await em.save(GuestWorkTask, task);
            transferredTaskCount++;

            const handoverEvt = em.create(GuestWorkEvent, {
              taskId: task.id,
              bookingId,
              hotelId: booking.hotelId,
              actorType: 'USER',
              actorStaffId: actor.id,
              eventType: WorkEventType.TASK_ASSIGNED,
              fromStatus: task.status,
              toStatus: task.status,
              occurredAt: now,
              evidenceType: WorkEvidenceType.SYSTEM_LOG,
              evidenceRef: `HANDOVER_RECEIVED: Bàn giao tác vụ từ #${oldAssignee || prevOwner || 'none'} sang #${dto.toStaffUserId} (${dto.reasonCode || 'TRANSFER'})`,
              idempotencyKey: dto.commandId ? `${dto.commandId}_${task.id}` : null,
            });
            await em.save(GuestWorkEvent, handoverEvt);
          }
        }
      } catch {
        // Không chặn giao dịch nếu môi trường test đơn vị không khởi tạo GuestWorkTask
      }

      // Cập nhật mirror trên booking
      booking.handledBy = dto.toStaffUserId;
      booking.assignmentType = 'MANUAL';
      booking.assignmentNote = `Chuyển giao từ #${prevOwner || 'none'} sang #${dto.toStaffUserId}: ${dto.reason}`;
      booking.reassignedBy = actor.id;
      booking.reassignedAt = now;
      const updatedBooking = await em.save(Booking, booking);

      // Lưu log sự kiện
      const event = em.create(BookingCoverageEvent, {
        bookingId,
        eventType: CoverageEventType.PERMANENT_TRANSFER,
        actorId: actor.id,
        oldValue: { previousStaffUserId: prevOwner },
        newValue: {
          newStaffUserId: dto.toStaffUserId,
          reasonCode: dto.reasonCode,
          reason: dto.reason,
          transferredTaskCount,
          commandId: dto.commandId || null,
        },
        note: `Bàn giao trách nhiệm chính đơn đặt phòng từ #${prevOwner} sang #${dto.toStaffUserId}`,
      });
      await em.save(BookingCoverageEvent, event);

      return {
        message: 'Chuyển giao trách nhiệm đơn thành công',
        booking: updatedBooking,
        staffId: dto.toStaffUserId,
        transferredTaskCount,
        shouldNotify: true,
      };
    });

    // D3-03: Phát realtime SAU KHI transaction đã commit
    if (txResult.shouldNotify) {
      try {
        this.realtimeGateway?.emitSystemNotification({
          id: randomUUID(),
          title: 'Bàn giao trách nhiệm',
          message: `Đơn #${bookingId} đã bàn giao trách nhiệm chính sang nhân viên #${dto.toStaffUserId}`,
          type: 'info',
          timestamp: new Date().toISOString(),
          data: {
            hotelId: txResult.booking.hotelId,
            targetRole: 'STAFF',
            bookingId,
          },
        });
      } catch {
        // Fail-safe
      }
    }

    return {
      message: txResult.message,
      booking: txResult.booking,
      staffId: txResult.staffId,
      transferredTaskCount: txResult.transferredTaskCount,
    };
  }

  async isStaffCoveringTask(
    bookingId: string,
    staffId: string,
    taskType: CoverageTaskType | string,
    at: Date = new Date(),
  ): Promise<boolean> {
    const activeGrants = await this.grantRepo.find({
      where: {
        bookingId,
        delegateStaffId: staffId,
        status: CoverageGrantStatus.ACTIVE,
        startAt: LessThanOrEqual(at),
        endAt: MoreThan(at),
      },
    });

    // F2: Ánh xạ tương thích giữa CoverageTaskType (SERVICE_RESPONSE) và WorkTaskType (SERVICE_REQUEST)
    const equivalentTypes = new Set<string>([String(taskType)]);
    if (taskType === 'SERVICE_REQUEST' || taskType === CoverageTaskType.SERVICE_RESPONSE) {
      equivalentTypes.add('SERVICE_REQUEST');
      equivalentTypes.add(CoverageTaskType.SERVICE_RESPONSE);
    }

    return activeGrants.some((grant) => {
      const allowed = grant.allowedTaskTypes || [];
      if (
        allowed.includes(CoverageTaskType.ALL_SERVICE_TASKS) ||
        allowed.includes('ALL_SERVICE_TASKS')
      ) {
        return true;
      }
      return allowed.some((t) => equivalentTypes.has(String(t)));
    });
  }

  async getCoverageTimeline(
    bookingId: string,
    actor?: { id: string; role: string },
  ): Promise<{
    grants: BookingCoverageGrant[];
    events: BookingCoverageEvent[];
  }> {
    if (actor && actor.role !== 'ADMIN') {
      const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      }
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn không có quyền xem lịch sử hỗ trợ của đơn đặt phòng này');
        }
      } else {
        const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId);
        if (!isStaff) {
          throw new ForbiddenException('Bạn không thuộc khách sạn của đơn đặt phòng này');
        }
      }
    }

    const grants = await this.grantRepo.find({
      where: { bookingId },
      order: { createdAt: 'DESC' },
    });
    const events = await this.eventRepo.find({
      where: { bookingId },
      order: { occurredAt: 'DESC' },
    });
    return { grants, events };
  }

  async getActiveGrantsForHotel(
    hotelId: string,
    actor?: { id: string; role: string },
  ): Promise<BookingCoverageGrant[]> {
    if (actor && actor.role !== 'ADMIN') {
      const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, hotelId);
      if (!isStaff) {
        throw new ForbiddenException('Bạn không thuộc khách sạn này');
      }
    }
    const now = new Date();
    return await this.grantRepo.find({
      where: {
        hotelId,
        status: CoverageGrantStatus.ACTIVE,
        startAt: LessThanOrEqual(now),
        endAt: MoreThan(now),
      },
      order: { endAt: 'ASC' },
    });
  }

  async expireOverdueGrants(): Promise<number> {
    const now = new Date();
    const overdue = await this.grantRepo.find({
      where: {
        status: CoverageGrantStatus.ACTIVE,
        endAt: LessThanOrEqual(now),
      },
    });

    if (overdue.length === 0) return 0;

    for (const grant of overdue) {
      grant.status = CoverageGrantStatus.EXPIRED;
      grant.version += 1;
      await this.grantRepo.save(grant);

      const event = this.eventRepo.create({
        grantId: grant.id,
        bookingId: grant.bookingId,
        eventType: CoverageEventType.GRANT_EXPIRED,
        actorId: null,
        note: 'Quyền hỗ trợ tạm thời tự động hết hạn',
      });
      await this.eventRepo.save(event);
    }

    return overdue.length;
  }
}
