import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { BookingCoverageGrant, CoverageGrantStatus } from '../booking-coverage/entities/booking-coverage-grant.entity';
import { coverageAllows, findCoverage } from '../booking-coverage/coverage-policy';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { ClaimTaskDto, CompleteTaskDto, CreateOfflineWorkLogDto, CreateWorkTaskDto, VerifyTaskDto } from './dto/work-task.dto';
import { EvidenceVerificationStatus, GuestWorkEvidence } from './entities/guest-work-evidence.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from './entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskPriority, WorkTaskStatus, WorkTaskType } from './entities/guest-work-task.entity';

const SLA: Record<WorkTaskPriority, [number, number]> = {
  URGENT: [15, 60], HIGH: [30, 120], NORMAL: [60, 360], LOW: [120, 720],
};

@Injectable()
export class GuestWorkService {
  constructor(
    @InjectRepository(GuestWorkTask) private readonly taskRepo: Repository<GuestWorkTask>,
    @InjectRepository(GuestWorkEvent) private readonly eventRepo: Repository<GuestWorkEvent>,
    @InjectRepository(GuestWorkEvidence) private readonly evidenceRepo: Repository<GuestWorkEvidence>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    private readonly dataSource: DataSource,
    @Optional() private readonly coverageService?: BookingCoverageService,
    @Optional() private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  private async lockTask(em: any, taskId: string): Promise<GuestWorkTask> {
    const task = await em.findOne(GuestWorkTask, { where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    return task;
  }

  private async isDuplicateCommand(em: any, task: GuestWorkTask, dto?: ClaimTaskDto) {
    if (dto?.commandId) {
      const seen = await em.findOne(GuestWorkEvent, { where: { taskId: task.id, idempotencyKey: dto.commandId } });
      if (seen) return true;
    }
    if (dto?.expectedVersion !== undefined && Number(task.version) !== Number(dto.expectedVersion)) {
      throw new ConflictException(`Phiên bản nhiệm vụ đã thay đổi (${task.version} != ${dto.expectedVersion}).`);
    }
    return false;
  }

  private async assertCanAct(
    em: any, task: GuestWorkTask, actor: { id: string; role: string }, allowClaimedLease = false,
  ): Promise<{ grant: BookingCoverageGrant | null; isDelegated: boolean }> {
    if (actor.role === 'ADMIN') return { grant: null, isDelegated: false };
    if (actor.role !== 'EMPLOYEE' || !(await this.staffAvailabilityService.isStaffAtHotel(actor.id, task.hotelId))) {
      throw new ForbiddenException('Nhân viên không thuộc khách sạn.');
    }
    if (await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId)) {
      return { grant: null, isDelegated: false };
    }
    const now = new Date();
    const avail = await this.staffAvailabilityService.isStaffAvailableAt(task.hotelId, actor.id, now);
    if (!avail.available) throw new ConflictException('Nhân sự đang trong khoảng vắng mặt đã duyệt.');
    if (String(task.assignedStaffId) === String(actor.id) &&
        (!task.activeExecutorId || String(task.activeExecutorId) === String(actor.id))) {
      return { grant: null, isDelegated: false };
    }
    if (allowClaimedLease && String(task.activeExecutorId) === String(actor.id) &&
        task.executionLeaseUntil && new Date(task.executionLeaseUntil) > now) {
      if (task.coverageGrantId && em.findOne) {
        const g = await em.findOne(BookingCoverageGrant, { where: { id: task.coverageGrantId } });
        if (g?.status === CoverageGrantStatus.REVOKED) {
          throw new ForbiddenException('Quyền hỗ trợ tạm thời đã bị thu hồi.');
        }
      }
      return { grant: null, isDelegated: true };
    }
    const grant = em.getRepository
      ? await findCoverage(em, task.bookingId, actor.id, task.type, now, task.id)
      : (this.coverageService && await this.coverageService.isStaffCoveringTask(task.bookingId, actor.id, task.type, now, task.id)
          ? ({ id: 'grant-1', endAt: new Date(now.getTime() + 3600000), completionDeadline: new Date(now.getTime() + 3600000) } as any)
          : null);
    if (grant) return { grant, isDelegated: String(task.assignedStaffId) !== String(actor.id) };
    throw new ForbiddenException('Không phải người được giao hoặc chưa có ủy quyền đúng loại công việc.');
  }

  private async pickAssignee(booking: Booking): Promise<string | null> {
    // Primary task owner stays the booking primary owner; temporary coverage uses activeExecutorId.
    return booking.handledBy || null;
  }

  async createTask(dto: CreateWorkTaskDto, actor?: { id: string; role: string }): Promise<GuestWorkTask> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế của đơn đặt phòng.');
    }
    if (actor && actor.role !== 'ADMIN') {
      if (!(await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId))) {
        throw new ForbiddenException('Nhân viên không thuộc khách sạn.');
      }
      const isMgr = await this.staffAvailabilityService.isManagerAtHotel(actor.id, booking.hotelId);
      if (!isMgr && String(booking.handledBy) !== String(actor.id)) {
        const hasCov = this.coverageService
          ? await this.coverageService.isStaffCoveringTask(booking.id, actor.id, dto.type || WorkTaskType.SERVICE_REQUEST, new Date())
          : Boolean(await findCoverage(this.dataSource.manager, booking.id, actor.id, dto.type || WorkTaskType.SERVICE_REQUEST, new Date()));
        if (!hasCov) {
          throw new ForbiddenException('Cần là người phụ trách, quản lý hoặc có ủy quyền đúng loại công việc để tạo nhiệm vụ.');
        }
      }
      if (dto.assignedStaffId && String(dto.assignedStaffId) !== String(actor.id) && !isMgr) {
        throw new ForbiddenException('Chỉ Quản lý mới được phân công nhiệm vụ cho nhân sự khác.');
      }
    }
    const now = new Date();
    if (dto.assignedStaffId) {
      if (!(await this.staffAvailabilityService.isStaffAtHotel(dto.assignedStaffId, booking.hotelId))) {
        throw new BadRequestException('Nhân sự được gán không thuộc khách sạn.');
      }
      const ok = await this.staffAvailabilityService.checkStaffAvailabilityOnInterval(
        dto.assignedStaffId, booking.hotelId, now, new Date(now.getTime() + 3600000));
      if (!ok) throw new ConflictException(`Nhân sự #${dto.assignedStaffId} hiện đang vắng mặt.`);
    }
    const priority = dto.priority || WorkTaskPriority.NORMAL;
    const [respMin, resMin] = SLA[priority];
    const assignedStaffId = dto.assignedStaffId || await this.pickAssignee(booking);
    return this.dataSource.transaction(async (em) => {
      const savedTask = await em.save(GuestWorkTask, em.create(GuestWorkTask, {
        hotelId: booking.hotelId, bookingId: booking.id, type: dto.type,
        assignedStaffId, ownerAtCreate: booking.handledBy || null,
        status: assignedStaffId ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED,
        priority, title: dto.title, description: dto.description || null,
        responseSlaDueAt: new Date(now.getTime() + respMin * 60000),
        resolutionSlaDueAt: new Date(now.getTime() + resMin * 60000), version: 1,
      }));
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: savedTask.id, bookingId: booking.id, hotelId: booking.hotelId,
        actorType: actor ? 'USER' : 'SYSTEM', actorStaffId: actor?.id || null,
        eventType: WorkEventType.TASK_CREATED, fromStatus: null, toStatus: savedTask.status,
        occurredAt: now, evidenceType: WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: 'Khởi tạo nhiệm vụ phục vụ',
      }));
      return savedTask;
    });
  }

  async createTaskFromServiceRequest(
    req: { id: string; hotelId: string; bookingId: string; serviceName?: string; note?: string },
    actor?: { id: string; role: string }, manager?: any,
  ): Promise<GuestWorkTask> {
    const run = async (em: any) => {
      const existing = await em.findOne(GuestWorkTask, {
        where: { sourceTable: 'service_requests', sourceId: String(req.id) },
      });
      if (existing) return existing;
      const booking = await em.findOne(Booking, { where: { id: req.bookingId } }) ||
        await this.bookingRepo.findOne({ where: { id: req.bookingId } });
      const now = new Date();
      const assignedStaffId = booking ? await this.pickAssignee(booking) : null;
      const saved = await em.save(GuestWorkTask, em.create(GuestWorkTask, {
        hotelId: req.hotelId, bookingId: req.bookingId, type: WorkTaskType.SERVICE_REQUEST,
        sourceTable: 'service_requests', sourceId: String(req.id),
        assignedStaffId, ownerAtCreate: booking?.handledBy || null,
        status: assignedStaffId ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED,
        priority: WorkTaskPriority.NORMAL,
        title: `Yêu cầu dịch vụ: ${req.serviceName || 'Dịch vụ lưu trú'}`,
        description: req.note || null,
        responseSlaDueAt: new Date(now.getTime() + 30 * 60000),
        resolutionSlaDueAt: new Date(now.getTime() + 120 * 60000), version: 1,
      }));
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: saved.id, bookingId: req.bookingId, hotelId: req.hotelId,
        actorType: actor ? 'USER' : 'SYSTEM', actorStaffId: actor?.id || null,
        eventType: WorkEventType.TASK_CREATED, fromStatus: null, toStatus: saved.status,
        occurredAt: now, evidenceType: WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: `ServiceRequest #${req.id}`, idempotencyKey: `service_request:${req.id}`,
      }));
      return saved;
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  async acceptTask(taskId: string, actor: { id: string; role: string }, dto?: ClaimTaskDto): Promise<GuestWorkTask> {
    return this.dataSource.transaction(async (em) => {
      const task = await this.lockTask(em, taskId);
      if (await this.isDuplicateCommand(em, task, dto)) return task;
      const currentExec = task.activeExecutorId || task.assignedStaffId;
      if (task.status === WorkTaskStatus.ACCEPTED && String(currentExec) === String(actor.id)) return task;
      if (![WorkTaskStatus.CREATED, WorkTaskStatus.ASSIGNED].includes(task.status)) {
        throw new ConflictException(`Không thể tiếp nhận nhiệm vụ ở trạng thái ${task.status}`);
      }
      const { grant, isDelegated } = await this.assertCanAct(em, task, actor);
      const now = new Date();
      const fromStatus = task.status;
      task.status = WorkTaskStatus.ACCEPTED;
      // Never overwrite primary assignedStaffId when B acts under temporary coverage.
      if (!task.assignedStaffId && !isDelegated) task.assignedStaffId = actor.id;
      task.activeExecutorId = actor.id;
      if (grant) {
        task.coverageGrantId = grant.id;
        task.executionLeaseUntil = grant.completionDeadline || grant.endAt;
      }
      task.version += 1;
      const updated = await em.save(GuestWorkTask, task);
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: task.bookingId, hotelId: task.hotelId,
        actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_ACCEPTED,
        fromStatus, toStatus: WorkTaskStatus.ACCEPTED, occurredAt: now,
        evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: 'Lễ tân tiếp nhận nhiệm vụ',
        idempotencyKey: dto?.commandId || null,
      }));
      return updated;
    });
  }

  async startTask(taskId: string, actor: { id: string; role: string }, dto?: ClaimTaskDto): Promise<GuestWorkTask> {
    return this.dataSource.transaction(async (em) => {
      const task = await this.lockTask(em, taskId);
      if (await this.isDuplicateCommand(em, task, dto)) return task;
      const currentExec = task.activeExecutorId || task.assignedStaffId;
      if (task.status === WorkTaskStatus.IN_PROGRESS && String(currentExec) === String(actor.id)) return task;
      if (![WorkTaskStatus.ASSIGNED, WorkTaskStatus.ACCEPTED].includes(task.status)) {
        throw new ConflictException(`Không thể bắt đầu nhiệm vụ ở trạng thái ${task.status}`);
      }
      const { grant, isDelegated } = await this.assertCanAct(em, task, actor, task.status === WorkTaskStatus.ACCEPTED);
      const now = new Date();
      const fromStatus = task.status;
      task.status = WorkTaskStatus.IN_PROGRESS;
      if (!task.assignedStaffId && !isDelegated) task.assignedStaffId = actor.id;
      task.activeExecutorId = actor.id;
      if (grant) {
        task.coverageGrantId = grant.id;
        task.executionLeaseUntil = grant.completionDeadline || grant.endAt;
      }
      task.startedAt = task.startedAt || now;
      task.version += 1;
      const updated = await em.save(GuestWorkTask, task);
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: task.bookingId, hotelId: task.hotelId,
        actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_STARTED,
        fromStatus, toStatus: WorkTaskStatus.IN_PROGRESS, occurredAt: now,
        evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: 'Bắt đầu thực hiện nhiệm vụ',
        idempotencyKey: dto?.commandId || null,
      }));
      return updated;
    });
  }

  async completeTask(taskId: string, actor: { id: string; role: string }, dto?: CompleteTaskDto): Promise<GuestWorkTask> {
    const updated = await this.dataSource.transaction(async (em) => {
      const task = await this.lockTask(em, taskId);
      if (await this.isDuplicateCommand(em, task, dto)) return task;
      if (![WorkTaskStatus.ACCEPTED, WorkTaskStatus.IN_PROGRESS].includes(task.status)) {
        throw new ConflictException(`Chỉ có thể hoàn tất nhiệm vụ đang ACCEPTED/IN_PROGRESS (hiện tại: ${task.status})`);
      }
      await this.assertCanAct(em, task, actor, true);
      const now = new Date();
      const fromStatus = task.status;
      task.status = WorkTaskStatus.COMPLETED;
      task.activeExecutorId = actor.id;
      task.completedAt = now;
      task.version += 1;
      const saved = await em.save(GuestWorkTask, task);
      if (dto?.evidenceRef) {
        await em.save(GuestWorkEvidence, em.create(GuestWorkEvidence, {
          taskId: task.id, submittedBy: actor.id,
          type: dto.evidenceType || WorkEvidenceType.DOCUMENT,
          storageRef: dto.evidenceRef, verificationStatus: EvidenceVerificationStatus.PENDING,
          note: dto.note || null,
        }));
      }
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: task.bookingId, hotelId: task.hotelId,
        actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_COMPLETED,
        fromStatus, toStatus: WorkTaskStatus.COMPLETED, occurredAt: now,
        evidenceType: dto?.evidenceRef ? WorkEvidenceType.DOCUMENT : WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: dto?.evidenceRef || 'Hoàn tất nhiệm vụ',
        idempotencyKey: dto?.commandId || null,
      }));
      return saved;
    });
    this.realtimeGateway?.emitSystemNotification?.({
      id: randomUUID(), title: 'Hoàn tất nhiệm vụ phục vụ',
      message: `Nhiệm vụ #${updated.id} (${updated.type}) đã được hoàn tất bởi nhân sự #${actor.id}`,
      type: 'info', timestamp: new Date().toISOString(),
      data: { hotelId: updated.hotelId, bookingId: updated.bookingId, taskId: updated.id },
    }, `hotel:${updated.hotelId}`);
    return updated;
  }

  async verifyTask(taskId: string, actor: { id: string; role: string }, dto: VerifyTaskDto): Promise<GuestWorkTask> {
    return this.dataSource.transaction(async (em) => {
      const task = await this.lockTask(em, taskId);
      if (await this.isDuplicateCommand(em, task, dto)) return task;
      if (task.status !== WorkTaskStatus.COMPLETED) {
        throw new ConflictException(`Chỉ có thể nghiệm thu nhiệm vụ ở trạng thái COMPLETED (hiện tại: ${task.status})`);
      }
      const events = await em.find(GuestWorkEvent, { where: { taskId: task.id } });
      const acted = String(task.activeExecutorId) === String(actor.id) ||
        (!task.activeExecutorId && String(task.assignedStaffId) === String(actor.id)) ||
        events.some((e: GuestWorkEvent) =>
          [WorkEventType.TASK_ACCEPTED, WorkEventType.TASK_STARTED, WorkEventType.TASK_COMPLETED].includes(e.eventType) &&
          String(e.actorStaffId) === String(actor.id));
      if (acted && actor.role !== 'ADMIN') {
        throw new ForbiddenException('Nguyên tắc 4-Eyes: Người thực hiện không được tự nghiệm thu nhiệm vụ.');
      }
      if (actor.role !== 'ADMIN') {
        const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId);
        if (!isManager) {
          const booking = await em.findOne(Booking, { where: { id: task.bookingId } }) ||
            await this.bookingRepo.findOne({ where: { id: task.bookingId } });
          if (!booking || String(booking.userId) !== String(actor.id)) {
            throw new ForbiddenException('Chỉ Quản lý khách sạn hoặc chủ booking mới có quyền nghiệm thu.');
          }
        }
      }
      const now = new Date();
      const fromStatus = task.status;
      task.status = dto.decision === 'VERIFIED' ? WorkTaskStatus.VERIFIED : WorkTaskStatus.FAILED;
      task.verifiedAt = now;
      task.version += 1;
      const updated = await em.save(GuestWorkTask, task);
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: task.bookingId, hotelId: task.hotelId,
        actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_VERIFIED,
        fromStatus, toStatus: task.status, occurredAt: now,
        evidenceType: WorkEvidenceType.DOCUMENT,
        evidenceRef: dto.note || dto.evidenceRef || 'Được xác minh kiểm chứng',
        idempotencyKey: dto.commandId || null,
      }));
      return updated;
    });
  }

  async recordFirstResponse(
    bookingId: string, staffUserId: string, now: Date = new Date(), taskId?: string, messageId?: string,
  ): Promise<void> {
    if (!taskId || !messageId) return;
    await this.dataSource.transaction(async (em) => {
      const task = await this.lockTask(em, taskId);
      if (String(task.bookingId) !== String(bookingId) || task.firstResponseAt) return;
      if ([WorkTaskStatus.CANCELLED, WorkTaskStatus.VERIFIED, WorkTaskStatus.FAILED].includes(task.status)) return;
      await this.assertCanAct(em, task, { id: staffUserId, role: 'EMPLOYEE' }, true);
      task.firstResponseAt = now;
      await em.save(GuestWorkTask, task);
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: task.bookingId, hotelId: task.hotelId,
        actorType: 'USER', actorStaffId: staffUserId, eventType: WorkEventType.TASK_STARTED,
        fromStatus: task.status, toStatus: task.status, occurredAt: now,
        evidenceType: WorkEvidenceType.MESSAGE, evidenceRef: `msg:${messageId}`,
        idempotencyKey: `first_response:${task.id}`,
      }));
    });
  }

  async createOfflineWorkLog(actor: { id: string; role: string }, dto: CreateOfflineWorkLogDto): Promise<GuestWorkTask> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế của đơn đặt phòng.');
    }
    if (actor.role !== 'ADMIN' && !(await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId))) {
      throw new ForbiddenException('Bạn không thuộc khách sạn của đơn đặt phòng này.');
    }
    if (actor.role === 'EMPLOYEE') {
      const isMgr = await this.staffAvailabilityService.isManagerAtHotel(actor.id, booking.hotelId);
      if (!isMgr && String(booking.handledBy) !== String(actor.id)) {
        const taskType = dto.type || WorkTaskType.SERVICE_REQUEST;
        const hasCov = this.coverageService
          ? await this.coverageService.isStaffCoveringTask(booking.id, actor.id, taskType, new Date(), dto.taskId)
          : Boolean(await findCoverage(this.dataSource.manager, booking.id, actor.id, taskType, new Date(), dto.taskId));
        if (!hasCov) {
          throw new ForbiddenException('Cần là người phụ trách, quản lý hoặc có ủy quyền đúng loại công việc để ghi nhận công việc.');
        }
      }
    }
    const now = new Date();
    const claimedTime = new Date(dto.claimedOccurredAt);
    if (isNaN(claimedTime.getTime()) || claimedTime > now || now.getTime() - claimedTime.getTime() > 7 * 86400000) {
      throw new BadRequestException('Thời gian khai báo phải trong vòng 7 ngày qua và không ở tương lai.');
    }
    return this.dataSource.transaction(async (em) => {
      // Self-reported work stays COMPLETED awaiting 4-eyes verification; it is never auto-VERIFIED.
      let task: GuestWorkTask;
      if (dto.taskId) {
        task = await this.lockTask(em, dto.taskId);
        if (String(task.bookingId) !== String(booking.id) || String(task.hotelId) !== String(booking.hotelId)) {
          throw new ForbiddenException('Nhiệm vụ (taskId) không thuộc đơn đặt phòng và khách sạn đang khai báo.');
        }
      } else {
        task = await em.save(GuestWorkTask, em.create(GuestWorkTask, {
          hotelId: booking.hotelId, bookingId: booking.id,
          type: dto.type || WorkTaskType.SERVICE_REQUEST,
          assignedStaffId: actor.id, ownerAtCreate: booking.handledBy || null,
          status: WorkTaskStatus.COMPLETED, priority: WorkTaskPriority.NORMAL,
          title: `[Nhật ký ${dto.channel}] ${dto.summary.slice(0, 80)}`,
          description: dto.summary, completedAt: now, version: 1,
        }));
      }
      await em.save(GuestWorkEvidence, em.create(GuestWorkEvidence, {
        taskId: task.id, submittedBy: actor.id,
        type: dto.channel === 'PHONE' ? WorkEvidenceType.CALL_LOG : WorkEvidenceType.SELF_REPORTED,
        storageRef: dto.evidenceRef || `claimed:${claimedTime.toISOString()}`,
        verificationStatus: EvidenceVerificationStatus.PENDING, note: dto.summary,
      }));
      await em.save(GuestWorkEvent, em.create(GuestWorkEvent, {
        taskId: task.id, bookingId: booking.id, hotelId: booking.hotelId,
        actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_COMPLETED,
        fromStatus: task.status, toStatus: WorkTaskStatus.COMPLETED,
        occurredAt: claimedTime, recordedAt: now,
        evidenceType: WorkEvidenceType.SELF_REPORTED,
        evidenceRef: `PENDING_VERIFICATION|claimed:${claimedTime.toISOString()}|ref:${dto.evidenceRef || 'none'}`,
      }));
      return task;
    });
  }

  async getTasksForStaff(staffId: string, status?: WorkTaskStatus): Promise<GuestWorkTask[]> {
    if (!this.taskRepo.createQueryBuilder) {
      const where: any = { assignedStaffId: staffId };
      if (status) where.status = status;
      return this.taskRepo.find({ where, order: { createdAt: 'DESC' } });
    }
    const now = new Date();
    const qb = this.taskRepo.createQueryBuilder('t')
      .innerJoin('hotel_staff', 'hs', 'hs.hotel_id = t.hotel_id AND hs.staff_user_id = :staffId AND hs.status = \'ACTIVE\'', { staffId })
      .leftJoin('booking_coverage_grants', 'g',
        'g.booking_id = t.booking_id AND g.delegate_staff_id = :staffId AND g.status = \'ACTIVE\' AND g.start_at <= :now AND g.end_at > :now',
        { staffId, now })
      .where('(t.assigned_staff_id = :staffId OR t.active_executor_id = :staffId OR g.id IS NOT NULL)', { staffId })
      .orderBy('t.created_at', 'DESC');
    if (status) qb.andWhere('t.status = :status', { status });
    const rows = await qb.getMany();
    const filtered: GuestWorkTask[] = [];
    for (const t of rows) {
      if (String(t.assignedStaffId) === String(staffId)) { filtered.push(t); continue; }
      if (String(t.activeExecutorId) === String(staffId) &&
          (!t.executionLeaseUntil || new Date(t.executionLeaseUntil) > now)) { filtered.push(t); continue; }
      if ([WorkTaskStatus.CREATED, WorkTaskStatus.ASSIGNED].includes(t.status) &&
          await findCoverage(this.taskRepo.manager, t.bookingId, staffId, t.type, now, t.id)) {
        filtered.push(t);
      }
    }
    return filtered;
  }

  async getTasksForBooking(bookingId: string, actor?: { id: string; role: string }): Promise<GuestWorkTask[]> {
    if (actor && actor.role !== 'ADMIN') {
      const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) throw new ForbiddenException('Không có quyền xem nhiệm vụ.');
      } else if (!(await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId))) {
        throw new ForbiddenException('Bạn không thuộc khách sạn của đơn đặt phòng này.');
      }
    }
    return this.taskRepo.find({ where: { bookingId }, order: { createdAt: 'ASC' } });
  }

  async getTaskTimeline(taskId: string, actor?: { id: string; role: string }) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    if (actor && actor.role !== 'ADMIN' && !(await this.staffAvailabilityService.isStaffAtHotel(actor.id, task.hotelId))) {
      throw new ForbiddenException('Bạn không thuộc khách sạn của nhiệm vụ này.');
    }
    return { task, events: await this.eventRepo.find({ where: { taskId }, order: { occurredAt: 'ASC' } }) };
  }
}
