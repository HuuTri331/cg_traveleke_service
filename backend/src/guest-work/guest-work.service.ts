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

    // D4-01: Chống nhận việc chéo người: nếu task đã có assignedStaffId khác người gọi,
    // phải là Manager đúng hotel hoặc có quyền coverage hợp lệ tại thời điểm nhận
    const isAssignedToOther = task.assignedStaffId && String(task.assignedStaffId) !== String(actor.id);
    if (isAssignedToOther && actor.role !== 'ADMIN') {
      const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId);
      let isCovering = false;
      if (this.coverageService) {
        isCovering = await this.coverageService.isStaffCoveringTask(task.bookingId, actor.id, task.type);
      }
      if (!isManager && !isCovering) {
        throw new ForbiddenException(
          `Nhiệm vụ này đã được phân công cho nhân sự #${task.assignedStaffId}. Bạn chưa có ủy quyền hỗ trợ để tiếp nhận việc này.`,
        );
      }
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

    const isStaff =
      typeof this.staffAvailabilityService.isStaffAtHotel === 'function'
        ? await this.staffAvailabilityService.isStaffAtHotel(actor.id, task.hotelId)
        : true;
    if (!isStaff && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ nhân viên thuộc khách sạn mới có quyền bắt đầu nhiệm vụ');
    }

    // D4-01: Kiểm tra quyền bắt đầu tác vụ: người được gán, manager hoặc coverage
    const isAssigned = String(task.assignedStaffId) === String(actor.id);
    const isManager =
      typeof this.staffAvailabilityService.isManagerAtHotel === 'function'
        ? await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId)
        : false;
    let isCovering = false;
    if (this.coverageService) {
      isCovering = await this.coverageService.isStaffCoveringTask(task.bookingId, actor.id, task.type);
    }
    if (!isAssigned && !isManager && !isCovering && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền bắt đầu nhiệm vụ này');
    }

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

    // D4-02: Xác thực quyền nghiệm thu: Phải là Quản lý đúng khách sạn (hoặc khách đúng booking trong trường hợp khách xác nhận)
    if (actor.role !== 'ADMIN') {
      const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, task.hotelId);
      if (!isManager) {
        // Kiểm tra xem có phải là khách hàng của booking không
        const booking = await this.bookingRepo.findOne({ where: { id: task.bookingId } });
        const isCustomerOwner = booking && String(booking.userId) === String(actor.id);
        if (!isCustomerOwner) {
          throw new ForbiddenException(
            'Chỉ Quản lý khách sạn (MANAGER) hoặc khách hàng của đơn đặt phòng mới có quyền nghiệm thu nhiệm vụ này',
          );
        }
      }
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

  async recordFirstResponse(
    bookingId: string,
    staffUserId: string,
    now: Date = new Date(),
    taskId?: string,
    clientMsgId?: string,
  ): Promise<void> {
    const where: any = { bookingId };
    if (taskId) {
      where.id = taskId;
    }

    const tasks = await this.taskRepo.find({ where });

    for (const task of tasks) {
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
          evidenceRef: clientMsgId
            ? `Tin nhắn phản hồi [msgId:${clientMsgId}] cho ticket #${task.id}`
            : `Lễ tân #${staffUserId} đã gửi tin nhắn phản hồi đầu tiên cho khách`,
        });
        await this.eventRepo.save(event);
      }
    }
  }

  /**
   * B5 / D4 / Section B5: Ghi nhận nhật ký công việc ngoài đời thực (gọi điện thoại, gặp tại quầy...)
   * Lưu rõ claimedOccurredAt (thời điểm tự khai) và recordedAt (thời điểm máy chủ ghi nhận),
   * không mạo danh là dữ liệu tự động của máy chủ (AUTO_VERIFIED).
   */
  async createOfflineWorkLog(
    actor: { id: string; role: string },
    dto: {
      bookingId: string;
      type?: WorkTaskType;
      channel: 'PHONE' | 'FRONT_DESK' | 'OFFLINE_OTHER';
      claimedOccurredAt: string;
      summary: string;
      evidenceRef?: string;
      taskId?: string;
    },
  ): Promise<GuestWorkTask> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    }

    if (actor.role !== 'ADMIN') {
      const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId);
      if (!isStaff) {
        throw new ForbiddenException('Bạn không thuộc khách sạn của đơn đặt phòng này.');
      }
    }

    const now = new Date();
    const claimedTime = new Date(dto.claimedOccurredAt);
    if (isNaN(claimedTime.getTime())) {
      throw new BadRequestException('Thời gian sự kiện ngoài đời khai báo không hợp lệ.');
    }

    let targetTask: GuestWorkTask | null = null;
    if (dto.taskId) {
      targetTask = await this.taskRepo.findOne({ where: { id: dto.taskId, bookingId: dto.bookingId } });
    }

    if (!targetTask) {
      targetTask = this.taskRepo.create({
        hotelId: booking.hotelId,
        bookingId: booking.id,
        type: dto.type || WorkTaskType.SERVICE_REQUEST,
        assignedStaffId: actor.id,
        ownerAtCreate: booking.handledBy || null,
        status: WorkTaskStatus.COMPLETED,
        priority: WorkTaskPriority.NORMAL,
        title: `[Nhật ký ${dto.channel}] ${dto.summary.slice(0, 80)}`,
        description: dto.summary,
        completedAt: now,
        version: 1,
      });
      targetTask = await this.taskRepo.save(targetTask);
    }

    const isManager = await this.staffAvailabilityService.isManagerAtHotel(actor.id, booking.hotelId);

    const event = this.eventRepo.create({
      taskId: targetTask.id,
      bookingId: booking.id,
      hotelId: booking.hotelId,
      actorType: 'USER',
      actorStaffId: actor.id,
      eventType: WorkEventType.TASK_COMPLETED,
      fromStatus: targetTask.status,
      toStatus: targetTask.status,
      occurredAt: claimedTime,
      recordedAt: now,
      evidenceType: isManager ? WorkEvidenceType.DOCUMENT : WorkEvidenceType.SELF_REPORTED,
      evidenceRef: `[${dto.channel}] Khai báo diễn ra lúc ${claimedTime.toLocaleString('vi-VN')} (Server ghi nhận lúc ${now.toLocaleString('vi-VN')}). Chứng cứ: ${dto.evidenceRef || 'Nhật ký đối soát quầy'} | Trạng thái: ${isManager ? 'MANUAL_VERIFIED' : 'SELF_REPORTED'}`,
    });
    await this.eventRepo.save(event);

    return targetTask;
  }

  async getTasksForStaff(staffId: string, status?: WorkTaskStatus): Promise<GuestWorkTask[]> {
    const where: any = { assignedStaffId: staffId };
    if (status) where.status = status;
    return await this.taskRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getTasksForBooking(
    bookingId: string,
    actor?: { id: string; role: string },
  ): Promise<GuestWorkTask[]> {
    if (actor && actor.role !== 'ADMIN') {
      const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      }
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn không có quyền xem nhiệm vụ của đơn đặt phòng này');
        }
      } else {
        const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, booking.hotelId);
        if (!isStaff) {
          throw new ForbiddenException('Bạn không thuộc khách sạn của đơn đặt phòng này');
        }
      }
    }
    return await this.taskRepo.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  async getTaskTimeline(
    taskId: string,
    actor?: { id: string; role: string },
  ): Promise<{ task: GuestWorkTask; events: GuestWorkEvent[] }> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ #${taskId}`);
    if (actor && actor.role !== 'ADMIN') {
      const isStaff = await this.staffAvailabilityService.isStaffAtHotel(actor.id, task.hotelId);
      if (!isStaff) {
        throw new ForbiddenException('Bạn không thuộc khách sạn của nhiệm vụ này');
      }
    }
    const events = await this.eventRepo.find({
      where: { taskId },
      order: { occurredAt: 'ASC' },
    });
    return { task, events };
  }
}
