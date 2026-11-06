import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BOOKING_DOMAIN_EVENTS } from '../common/events/booking-domain-event-registry';
import { OutboxService } from '../outbox/outbox.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import {
  RoomUnit,
  RoomUnitHousekeepingState,
} from '../room-units/entities/room-unit.entity';
import { HousekeepingEvent } from './entities/housekeeping-event.entity';
import {
  HousekeepingTask,
  HousekeepingTaskKind,
  HousekeepingTaskStatus,
} from './entities/housekeeping-task.entity';
import {
  assertFourEyesInspection,
  resolveUnitStateAfterInspection,
} from './housekeeping-policy';

export interface CreateHousekeepingFromCheckoutPayload {
  hotelId: string;
  bookingId: string;
  unitId: string;
  nextArrivalBookingId?: string | null;
  dueAt?: Date | string;
  sourceEventKey?: string;
}

@Injectable()
export class HousekeepingService {
  constructor(
    @InjectRepository(HousekeepingTask)
    private readonly taskRepo: Repository<HousekeepingTask>,
    @InjectRepository(HousekeepingEvent)
    private readonly eventRepo: Repository<HousekeepingEvent>,
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepo: Repository<RoomUnit>,
    private readonly dataSource: DataSource,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  private async assertHotelStaffScope(
    actor: { id: string; role: string },
    hotelId: string,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn của công việc buồng phòng này.');
    }
  }

  async createFromCheckoutOnce(
    payload: CreateHousekeepingFromCheckoutPayload,
  ): Promise<HousekeepingTask> {
    const sourceKey =
      (payload.sourceEventKey || '').trim() ||
      `${BOOKING_DOMAIN_EVENTS.ROOM_CHECKOUT_CONFIRMED_V1}:${payload.bookingId}:${payload.unitId}`;

    const existing = await this.taskRepo.findOne({
      where: { sourceEventKey: sourceKey },
    });
    if (existing) {
      return existing;
    }

    const dueAt = payload.dueAt
      ? new Date(payload.dueAt)
      : new Date(Date.now() + 90 * 60 * 1000);

    const task = this.taskRepo.create({
      hotelId: String(payload.hotelId),
      unitId: String(payload.unitId),
      bookingId: payload.bookingId ? String(payload.bookingId) : null,
      nextArrivalBookingId: payload.nextArrivalBookingId ? String(payload.nextArrivalBookingId) : null,
      kind: HousekeepingTaskKind.CHECKOUT_CLEAN,
      priority: payload.nextArrivalBookingId ? 'URGENT' : 'NORMAL',
      status: HousekeepingTaskStatus.OPEN,
      dueAt,
      sourceEventKey: sourceKey,
      version: 1,
    });

    const saved = await this.taskRepo.save(task);
    await this.roomUnitRepo.update(
      { id: String(payload.unitId) },
      { housekeepingState: RoomUnitHousekeepingState.DIRTY },
    );
    return saved;
  }

  async listHotelTasks(
    hotelId: string,
    actor: { id: string; role: string },
    status?: HousekeepingTaskStatus,
  ): Promise<HousekeepingTask[]> {
    await this.assertHotelStaffScope(actor, String(hotelId));
    const where: any = { hotelId: String(hotelId) };
    if (status) where.status = status;
    return this.taskRepo.find({
      where,
      order: { dueAt: 'ASC', id: 'ASC' },
    });
  }

  async startTask(
    taskId: string,
    actor: { id: string; role: string },
    commandId?: string,
  ): Promise<HousekeepingTask> {
    const task = await this.taskRepo.findOne({ where: { id: String(taskId) } });
    if (!task) throw new NotFoundException(`Housekeeping task #${taskId} không tồn tại.`);
    await this.assertHotelStaffScope(actor, task.hotelId);

    if (task.status === HousekeepingTaskStatus.IN_PROGRESS) return task;
    if (task.status !== HousekeepingTaskStatus.OPEN && task.status !== HousekeepingTaskStatus.ISSUE_REPORTED) {
      throw new ConflictException(`Không thể bắt đầu dọn phòng ở trạng thái ${task.status}.`);
    }

    const prev = task.status;
    task.status = HousekeepingTaskStatus.IN_PROGRESS;
    task.assignedTo = String(actor.id);
    task.startedAt = new Date();
    task.version += 1;
    const saved = await this.taskRepo.save(task);

    await this.eventRepo.save(
      this.eventRepo.create({
        taskId: String(saved.id),
        hotelId: saved.hotelId,
        unitId: saved.unitId,
        eventType: 'CLEANING_STARTED',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        commandId: commandId || null,
      }),
    );
    return saved;
  }

  async completeTask(
    taskId: string,
    checklistJson: Record<string, any> | null,
    actor: { id: string; role: string },
    commandId?: string,
  ): Promise<HousekeepingTask> {
    const task = await this.taskRepo.findOne({ where: { id: String(taskId) } });
    if (!task) throw new NotFoundException(`Housekeeping task #${taskId} không tồn tại.`);
    await this.assertHotelStaffScope(actor, task.hotelId);

    if (task.status === HousekeepingTaskStatus.CLEANED || task.status === HousekeepingTaskStatus.INSPECTED_READY) {
      return task;
    }

    const unit = await this.roomUnitRepo.findOne({ where: { id: String(task.unitId) } });
    if (!unit) throw new NotFoundException(`Phòng vật lý #${task.unitId} không tồn tại.`);

    const settings = await this.propertySettings.getHotelSettings(task.hotelId);
    const prev = task.status;
    task.cleanedBy = String(actor.id);
    task.cleanedAt = new Date();
    task.checklistJson = checklistJson || null;
    task.version += 1;

    if (!settings.requireRoomInspection) {
      const nextState = resolveUnitStateAfterInspection(unit, true);
      task.status = HousekeepingTaskStatus.INSPECTED_READY;
      task.inspectedAt = new Date();
      unit.housekeepingState = nextState;
      unit.lastCleanedAt = task.cleanedAt;
      await this.roomUnitRepo.save(unit);
    } else {
      task.status = HousekeepingTaskStatus.CLEANED;
      unit.housekeepingState = RoomUnitHousekeepingState.CLEAN;
      unit.lastCleanedAt = task.cleanedAt;
      await this.roomUnitRepo.save(unit);
    }

    const saved = await this.taskRepo.save(task);
    await this.eventRepo.save(
      this.eventRepo.create({
        taskId: String(saved.id),
        hotelId: saved.hotelId,
        unitId: saved.unitId,
        eventType: 'CLEANING_COMPLETED',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        commandId: commandId || null,
      }),
    );
    return saved;
  }

  async inspectTask(
    taskId: string,
    approved: boolean,
    note: string | undefined,
    actor: { id: string; role: string },
    commandId?: string,
  ): Promise<HousekeepingTask> {
    const task = await this.taskRepo.findOne({ where: { id: String(taskId) } });
    if (!task) throw new NotFoundException(`Housekeeping task #${taskId} không tồn tại.`);
    await this.assertHotelStaffScope(actor, task.hotelId);

    if (task.status === HousekeepingTaskStatus.INSPECTED_READY && approved) {
      return task;
    }
    if (task.status !== HousekeepingTaskStatus.CLEANED) {
      throw new ConflictException(
        `Chỉ có thể nghiệm thu (inspect) phòng khi trạng thái task là CLEANED (hiện tại: ${task.status}).`,
      );
    }

    assertFourEyesInspection(task, actor);

    const unit = await this.roomUnitRepo.findOne({ where: { id: String(task.unitId) } });
    if (!unit) throw new NotFoundException(`Phòng vật lý #${task.unitId} không tồn tại.`);

    const resultingUnitState = resolveUnitStateAfterInspection(unit, approved);
    const prev = task.status;

    if (approved) {
      task.status = HousekeepingTaskStatus.INSPECTED_READY;
      task.inspectorId = String(actor.id);
      task.inspectedAt = new Date();
      unit.housekeepingState = resultingUnitState;
      unit.lastInspectedAt = task.inspectedAt;
      unit.lastInspectedBy = String(actor.id);
    } else {
      task.status = HousekeepingTaskStatus.OPEN;
      task.issueNote = note || 'Không đạt nghiệm thu buồng phòng, yêu cầu dọn lại.';
      unit.housekeepingState = RoomUnitHousekeepingState.DIRTY;
    }

    task.version += 1;
    await this.roomUnitRepo.save(unit);
    const saved = await this.taskRepo.save(task);

    await this.eventRepo.save(
      this.eventRepo.create({
        taskId: String(saved.id),
        hotelId: saved.hotelId,
        unitId: saved.unitId,
        eventType: approved ? 'INSPECTION_APPROVED' : 'INSPECTION_REJECTED',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        note: note || null,
        commandId: commandId || null,
      }),
    );

    if (approved && this.outboxService) {
      await this.outboxService.addEvent(
        this.dataSource.manager,
        BOOKING_DOMAIN_EVENTS.ROOM_READY_V1,
        'ROOM_UNIT',
        String(unit.id),
        {
          hotelId: saved.hotelId,
          unitId: saved.unitId,
          taskId: saved.id,
          nextArrivalBookingId: saved.nextArrivalBookingId,
          inspectedBy: actor.id,
        },
      );
    }

    return saved;
  }

  async reportIssue(
    taskId: string,
    issueNote: string,
    actor: { id: string; role: string },
    commandId?: string,
  ): Promise<HousekeepingTask> {
    if (!issueNote || !issueNote.trim()) {
      throw new BadRequestException('Mô tả sự cố (issueNote) không được để trống.');
    }
    const task = await this.taskRepo.findOne({ where: { id: String(taskId) } });
    if (!task) throw new NotFoundException(`Housekeeping task #${taskId} không tồn tại.`);
    await this.assertHotelStaffScope(actor, task.hotelId);

    const prev = task.status;
    task.status = HousekeepingTaskStatus.ISSUE_REPORTED;
    task.issueNote = issueNote.trim();
    task.version += 1;
    const saved = await this.taskRepo.save(task);

    await this.eventRepo.save(
      this.eventRepo.create({
        taskId: String(saved.id),
        hotelId: saved.hotelId,
        unitId: saved.unitId,
        eventType: 'ISSUE_REPORTED',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        note: issueNote.trim(),
        commandId: commandId || null,
      }),
    );
    return saved;
  }
}
