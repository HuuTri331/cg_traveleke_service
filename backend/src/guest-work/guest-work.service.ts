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
import { Repository, DataSource, In } from 'typeorm';
import {
  GuestWorkTask,
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskPriority,
} from './entities/guest-work-task.entity';
import {
  GuestWorkEvent,
  WorkEventType,
  WorkEvidenceType,
} from './entities/guest-work-event.entity';
import {
  GuestWorkEvidence,
  EvidenceVerificationStatus,
} from './entities/guest-work-evidence.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateWorkTaskDto, CompleteTaskDto, VerifyTaskDto } from './dto/work-task.dto';

@Injectable()
export class GuestWorkService {
  private readonly logger = new Logger(GuestWorkService.name);

  constructor(
    @InjectRepository(GuestWorkTask)
    private readonly taskRepo: Repository<GuestWorkTask>,
    @InjectRepository(GuestWorkEvent)
    private readonly eventRepo: Repository<GuestWorkEvent>,
    @InjectRepository(GuestWorkEvidence)
    private readonly evidenceRepo: Repository<GuestWorkEvidence>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly coverageService?: BookingCoverageService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async createTask(
    dto: CreateWorkTaskDto,
    actor?: { id: string; role: string },
  ): Promise<GuestWorkTask> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    }

    const now = new Date();

    if (dto.assignedStaffId) {
      const isAvailable = await this.staffAvailabilityService.checkStaffAvailabilityOnInterval(
        dto.assignedStaffId,
        booking.hotelId,
        now,
        new Date(now.getTime() + 60 * 60 * 1000),
      );
      if (!isAvailable) {
        throw new ConflictException(
          `Nhân sự #${dto.assignedStaffId} hiện đang có lịch nghỉ hoặc không khả dụng`,
        );
      }
    }

    const priority = dto.priority || WorkTaskPriority.NORMAL;

    // Tính toán SLA chuẩn theo mức độ ưu tiên
    let responseMinutes = 60;
    let resolutionMinutes = 360;
    if (priority === WorkTaskPriority.URGENT) {
      responseMinutes = 15;
      resolutionMinutes = 60;
    } else if (priority === WorkTaskPriority.HIGH) {
      responseMinutes = 30;
      resolutionMinutes = 120;
    } else if (priority === WorkTaskPriority.LOW) {
      responseMinutes = 120;
      resolutionMinutes = 720;
    }

    const responseSlaDueAt = new Date(now.getTime() + responseMinutes * 60 * 1000);
    const resolutionSlaDueAt = new Date(now.getTime() + resolutionMinutes * 60 * 1000);

    const assignedStaffId = dto.assignedStaffId || booking.handledBy || null;

    return await this.dataSource.transaction(async (em) => {
      const task = em.create(GuestWorkTask, {
        hotelId: booking.hotelId,
        bookingId: booking.id,
        type: dto.type,
        assignedStaffId,
        ownerAtCreate: booking.handledBy || null,
        status: assignedStaffId ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED,
        priority,
        title: dto.title,
        description: dto.description || null,
        responseSlaDueAt,
        resolutionSlaDueAt,
        version: 1,
      });
      const savedTask = await em.save(GuestWorkTask, task);

      const event = em.create(GuestWorkEvent, {
        taskId: savedTask.id,
        bookingId: booking.id,
        hotelId: booking.hotelId,
        actorType: actor ? 'USER' : 'SYSTEM',
        actorStaffId: actor ? actor.id : null,
        eventType: WorkEventType.TASK_CREATED,
        fromStatus: null,
        toStatus: savedTask.status,
        occurredAt: now,
        evidenceType: WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: 'Hệ thống tự động khởi tạo nhiệm vụ phục vụ',
      });
      await em.save(GuestWorkEvent, event);

      return savedTask;
    });
  }

  async createTaskFromServiceRequest(
    req: { id: string; hotelId: string; bookingId: string; serviceName?: string; note?: string },
    actor?: { id: string; role: string },
  ): Promise<GuestWorkTask> {
    const existing = await this.taskRepo.findOne({
      where: { sourceTable: 'service_requests', sourceId: req.id },
    });
    if (existing) {
      return existing;
    }

    const booking = await this.bookingRepo.findOne({ where: { id: req.bookingId } });
    const now = new Date();
    const priority = WorkTaskPriority.NORMAL;

    const responseSlaDueAt = new Date(now.getTime() + 30 * 60 * 1000);
    const resolutionSlaDueAt = new Date(now.getTime() + 120 * 60 * 1000);

    const task = this.taskRepo.create({
      hotelId: req.hotelId,
      bookingId: req.bookingId,
      type: WorkTaskType.SERVICE_REQUEST,
      sourceTable: 'service_requests',
      sourceId: req.id,
      assignedStaffId: booking?.handledBy || null,
      ownerAtCreate: booking?.handledBy || null,
      status: booking?.handledBy ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED,
      priority,
      title: `Yêu cầu dịch vụ: ${req.serviceName || 'Dịch vụ lưu trú'}`,
      description: req.note || null,
      responseSlaDueAt,
      resolutionSlaDueAt,
      version: 1,
    });
    const saved = await this.taskRepo.save(task);

    const event = this.eventRepo.create({
      taskId: saved.id,
      bookingId: req.bookingId,
      hotelId: req.hotelId,
      actorType: actor ? 'USER' : 'SYSTEM',
      actorStaffId: actor?.id || null,
      eventType: WorkEventType.TASK_CREATED,
      toStatus: saved.status,
      occurredAt: now,
      evidenceType: WorkEvidenceType.SYSTEM_LOG,
      evidenceRef: `ServiceRequest #${req.id}`,
    });
    await this.eventRepo.save(event);

    return saved;
  }

  async acceptTask(
    taskId: string,
    actor: { id: string; role: string },
  ): Promise<GuestWorkTask> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    }

    const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, task.hotelId);
    if (!isStaff && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ nhân viên của khách sạn mới có quyền tiếp nhận nhiệm vụ');
    }

    const now = new Date();
    return await this.dataSource.transaction(async (em) => {
      const fromStatus = task.status;
      task.status = WorkTaskStatus.ACCEPTED;
      task.assignedStaffId = actor.id;
      task.startedAt = task.startedAt || now;
      task.version += 1;
      const updated = await em.save(GuestWorkTask, task);

      const event = em.create(GuestWorkEvent, {
        taskId: task.id,
        bookingId: task.bookingId,
        hotelId: task.hotelId,
        actorType: 'USER',
        actorStaffId: actor.id,
        eventType: WorkEventType.TASK_ACCEPTED,
        fromStatus,
        toStatus: WorkTaskStatus.ACCEPTED,
        occurredAt: now,
        evidenceType: WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: 'Lễ tân xác nhận tiếp nhận nhiệm vụ trên Dashboard',
      });
      await em.save(GuestWorkEvent, event);

      return updated;
    });
  }

  async startTask(
    taskId: string,
    actor: { id: string; role: string },
  ): Promise<GuestWorkTask> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);

    const now = new Date();
    const fromStatus = task.status;
    task.status = WorkTaskStatus.IN_PROGRESS;
    task.startedAt = task.startedAt || now;
    task.version += 1;
    const updated = await this.taskRepo.save(task);

    const event = this.eventRepo.create({
      taskId: task.id,
      bookingId: task.bookingId,
      hotelId: task.hotelId,
      actorType: 'USER',
      actorStaffId: actor.id,
      eventType: WorkEventType.TASK_STARTED,
      fromStatus,
      toStatus: WorkTaskStatus.IN_PROGRESS,
      occurredAt: now,
    });
    await this.eventRepo.save(event);

    return updated;
  }

  async completeTask(
    taskId: string,
    actor: { id: string; role: string },
    dto?: CompleteTaskDto,
  ): Promise<GuestWorkTask> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    }

    // Kiểm tra quyền: phải là người được giao, hoặc có coverage, hoặc là manager
    const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId);
    const isAssigned = String(task.assignedStaffId) === String(actor.id);
    let isCovering = false;
    if (this.coverageService) {
      isCovering = await this.coverageService.isStaffCoveringTask(task.bookingId, actor.id, task.type);
    }

    if (!isAssigned && !isManager && !isCovering && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền hoàn tất nhiệm vụ này (không phải người được giao hoặc chưa có quyền hỗ trợ)');
    }

    const now = new Date();
    return await this.dataSource.transaction(async (em) => {
      const fromStatus = task.status;
      task.status = WorkTaskStatus.COMPLETED;
      task.completedAt = now;
      task.version += 1;
      const updated = await em.save(GuestWorkTask, task);

      const event = em.create(GuestWorkEvent, {
        taskId: task.id,
        bookingId: task.bookingId,
        hotelId: task.hotelId,
        actorType: 'USER',
        actorStaffId: actor.id,
        eventType: WorkEventType.TASK_COMPLETED,
        fromStatus,
        toStatus: WorkTaskStatus.COMPLETED,
        occurredAt: now,
        evidenceType: dto?.evidenceRef ? WorkEvidenceType.DOCUMENT : WorkEvidenceType.SYSTEM_LOG,
        evidenceRef: dto?.evidenceRef || 'Xác nhận hoàn tất trên Dashboard',
      });
      await em.save(GuestWorkEvent, event);

      this.realtimeGateway?.emitSystemNotification?.(
        {
          id: randomUUID(),
          title: 'Hoàn tất nhiệm vụ phục vụ',
          message: `Nhiệm vụ #${task.id} (${task.type}) đã được hoàn tất bởi nhân sự #${actor.id}`,
          type: 'info',
          timestamp: new Date().toISOString(),
          data: {
            hotelId: task.hotelId,
            targetRole: 'STAFF',
            taskId: task.id,
            bookingId: task.bookingId,
          },
        },
        `hotel:${task.hotelId}`,
      );

      return updated;
    });
  }

  async verifyTask(
    taskId: string,
    actor: { id: string; role: string },
    dto: VerifyTaskDto,
  ): Promise<GuestWorkTask> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    }

    // Nguyên tắc 4-Eyes: Nhân sự được phân công thực hiện không được tự nghiệm thu
    if (String(task.assignedStaffId) === String(actor.id) && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Nguyên tắc 4-Eyes: Nhân sự thực hiện không được tự nghiệm thu nhiệm vụ của chính mình',
      );
    }

    const now = new Date();
    const fromStatus = task.status;
    task.status = dto.decision === 'VERIFIED' ? WorkTaskStatus.VERIFIED : WorkTaskStatus.FAILED;
    task.verifiedAt = now;
    task.version += 1;
    const updated = await this.taskRepo.save(task);

    const event = this.eventRepo.create({
      taskId: task.id,
      bookingId: task.bookingId,
      hotelId: task.hotelId,
      actorType: 'USER',
      actorStaffId: actor.id,
      eventType: WorkEventType.TASK_VERIFIED,
      fromStatus,
      toStatus: task.status,
      occurredAt: now,
      evidenceType: WorkEvidenceType.DOCUMENT,
      evidenceRef: dto.note || dto.evidenceRef || 'Được xác minh kiểm chứng',
    });
    await this.eventRepo.save(event);

    return updated;
  }

  async recordFirstResponse(bookingId: string, staffUserId: string, now: Date = new Date()): Promise<void> {
    const pendingTasks = await this.taskRepo.find({
      where: {
        bookingId,
        firstResponseAt: undefined as any,
      },
    });

    for (const task of pendingTasks) {
      if (!task.firstResponseAt) {
        task.firstResponseAt = now;
        await this.taskRepo.save(task);

        const event = this.eventRepo.create({
          taskId: task.id,
          bookingId: task.bookingId,
          hotelId: task.hotelId,
          actorType: 'USER',
          actorStaffId: staffUserId,
          eventType: WorkEventType.TASK_STARTED,
          fromStatus: task.status,
          toStatus: task.status,
          occurredAt: now,
          evidenceType: WorkEvidenceType.MESSAGE,
          evidenceRef: 'Lễ tân đã gửi tin nhắn phản hồi đầu tiên cho khách',
        });
        await this.eventRepo.save(event);
      }
    }
  }

  async getTasksForStaff(staffId: string, status?: WorkTaskStatus): Promise<GuestWorkTask[]> {
    const where: any = { assignedStaffId: staffId };
    if (status) where.status = status;
    return await this.taskRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getTasksForBooking(bookingId: string): Promise<GuestWorkTask[]> {
    return await this.taskRepo.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  async getTaskTimeline(taskId: string): Promise<{ task: GuestWorkTask; events: GuestWorkEvent[] }> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    const events = await this.eventRepo.find({
      where: { taskId },
      order: { occurredAt: 'ASC' },
    });
    return { task, events };
  }
}
