import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import {
  assertBookingOperator,
  assertCommittedEntitlement,
} from '../bookings/services/booking-operation-policy';
import { BookingWritePolicy } from '../bookings/services/booking-write-policy';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { RoomUnitAllocationCommand } from './entities/room-unit-allocation-command.entity';
import {
  RoomUnitAllocation,
  RoomUnitAllocationStatus,
} from './entities/room-unit-allocation.entity';
import { RoomUnitAllocationEvent } from './entities/room-unit-allocation-event.entity';
import {
  RoomUnitStaySlot,
  RoomUnitStaySlotStatus,
} from './entities/room-unit-stay-slot.entity';
import {
  RoomUnit,
  RoomUnitHousekeepingState,
  RoomUnitOperationalStatus,
} from './entities/room-unit.entity';

export interface AllocateRoomUnitsInput {
  unitIds: string[];
  commandId: string;
  expectedVersion?: number;
  expectedBookingVersion?: number;
}

export interface AllocateRoomUnitsCommand {
  bookingId: string;
  unitIds: string[];
  commandId: string;
  expectedBookingVersion: number;
  actor: { id: string; role: string };
  hotelTimezone?: string;
}

@Injectable()
export class RoomAllocationService {
  constructor(
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepo: Repository<RoomUnit>,
    @InjectRepository(RoomUnitAllocation)
    private readonly allocationRepo: Repository<RoomUnitAllocation>,
    @InjectRepository(RoomUnitStaySlot)
    private readonly staySlotRepo: Repository<RoomUnitStaySlot>,
    @InjectRepository(RoomUnitAllocationEvent)
    private readonly eventRepo: Repository<RoomUnitAllocationEvent>,
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
    @Optional() private readonly bookingWritePolicy?: BookingWritePolicy,
    @Optional()
    @InjectRepository(RoomUnitAllocationCommand)
    private readonly commandRepo?: Repository<RoomUnitAllocationCommand>,
  ) {}

  async getBookingAllocations(bookingId: string, em?: EntityManager): Promise<RoomUnitAllocation[]> {
    const repo = em ? em.getRepository(RoomUnitAllocation) : this.allocationRepo;
    return repo.find({
      where: {
        bookingId: String(bookingId),
        status: In([RoomUnitAllocationStatus.ASSIGNED, RoomUnitAllocationStatus.CHECKED_IN]),
      },
      order: { id: 'ASC' },
    });
  }

  async getCandidates(bookingId: string, actor: { id: string; role: string }) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    await assertBookingOperator(
      this.dataSource.manager,
      booking,
      actor,
      'ASSIGN_ROOM',
    );

    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const stayNights = this.propertyClock.enumerateStayNights(
      booking.checkInAt,
      booking.checkOutAt,
      settings.ianaTimezone,
    );

    const bookingRooms = await this.dataSource.getRepository(BookingRoom).find({
      where: { bookingId: String(booking.id) },
    });
    const requiredRoomTypeIds = Array.from(new Set(bookingRooms.map((r) => String(r.roomId))));
    const allUnits = await this.roomUnitRepo.find({
      where: {
        hotelId: String(booking.hotelId),
        ...(requiredRoomTypeIds.length > 0 ? { roomTypeId: In(requiredRoomTypeIds) } : {}),
        operationalStatus: RoomUnitOperationalStatus.ACTIVE,
      },
      order: { roomNumber: 'ASC' },
    });

    const occupiedSlots = await this.staySlotRepo.find({
      where: {
        hotelId: String(booking.hotelId),
        stayDate: In(stayNights),
        status: RoomUnitStaySlotStatus.ACTIVE,
      },
    });
    const busyUnitIds = new Set(
      occupiedSlots
        .filter((s) => String(s.bookingId) !== String(booking.id))
        .map((s) => String(s.unitId)),
    );

    return allUnits.filter((u) => !busyUnitIds.has(String(u.id)));
  }

  async assertBookingRoomReady(bookingId: string, em?: EntityManager): Promise<RoomUnit[]> {
    const runner = em || this.dataSource.manager;
    const allocations = await this.getBookingAllocations(bookingId, runner);
    if (allocations.length === 0) {
      throw new ConflictException(
        'ROOM_UNIT_ALLOCATION_REQUIRED: Booking chưa được gán phòng vật lý cụ thể trước khi check-in.',
      );
    }
    const unitIds = allocations.map((a) => String(a.roomUnitId));
    const units = await runner.getRepository(RoomUnit).find({
      where: { id: In(unitIds) },
    });
    if (units.length !== unitIds.length) {
      throw new ConflictException('ROOM_UNIT_NOT_FOUND: Phòng vật lý đã gán không tồn tại.');
    }
    for (const unit of units) {
      if (unit.verificationStatus === 'UNVERIFIED') {
        throw new ConflictException(
          `ROOM_NOT_READY: Phòng #${unit.roomNumber} chưa được xác minh (UNVERIFIED).`,
        );
      }
      if (
        unit.operationalStatus !== RoomUnitOperationalStatus.ACTIVE &&
        unit.operationalStatus !== RoomUnitOperationalStatus.IN_SERVICE
      ) {
        throw new ConflictException(
          `ROOM_UNIT_OUT_OF_ORDER: Phòng #${unit.roomNumber} đang ở trạng thái ${unit.operationalStatus}.`,
        );
      }
      if (unit.housekeepingState !== RoomUnitHousekeepingState.READY) {
        throw new ConflictException(
          `ROOM_NOT_READY: Phòng #${unit.roomNumber} đang ở trạng thái buồng phòng ${unit.housekeepingState} (cần READY trước khi check-in).`,
        );
      }
    }
    return units;
  }

  /**
   * Codebook Section 3.1 hook alias: verifies assigned physical units are verified, IN_SERVICE/ACTIVE, and READY.
   */
  async assertReadyAssigned(em: EntityManager, booking: Booking): Promise<RoomUnit[]> {
    return this.assertBookingRoomReady(String(booking.id), em);
  }

  async allocate(
    bookingIdOrCommand: string | AllocateRoomUnitsCommand,
    inputArg?: AllocateRoomUnitsInput,
    actorArg?: { id: string; role: string },
  ): Promise<RoomUnitAllocation[]> {
    const isCmd = typeof bookingIdOrCommand === 'object' && bookingIdOrCommand !== null;
    const bookingId = isCmd ? String(bookingIdOrCommand.bookingId) : String(bookingIdOrCommand);
    const input: AllocateRoomUnitsInput = isCmd
      ? {
          unitIds: bookingIdOrCommand.unitIds,
          commandId: bookingIdOrCommand.commandId,
          expectedBookingVersion: bookingIdOrCommand.expectedBookingVersion,
        }
      : inputArg!;
    const actor = isCmd ? bookingIdOrCommand.actor : actorArg!;

    const cmdId = (input?.commandId || '').trim();
    const rawIds = Array.isArray(input?.unitIds)
      ? input.unitIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!cmdId || rawIds.length === 0 || new Set(rawIds).size !== rawIds.length) {
      throw new BadRequestException('commandId và danh sách unit duy nhất là bắt buộc');
    }

    const uniqueUnitIds = [...rawIds].sort((a, b) => Number(a) - Number(b));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ bookingId, unitIds: uniqueUnitIds }))
      .digest('hex');

    if (this.commandRepo) {
      const prior = await this.commandRepo.findOne({
        where: { bookingId: String(bookingId), commandKey: cmdId },
      });
      if (prior && prior.requestHash !== requestHash) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD');
      }
    }

    const existingCmd = await this.allocationRepo.find({
      where: { bookingId: String(bookingId), commandId: cmdId },
    });
    if (existingCmd.length > 0) return existingCmd;

    try {
      return await this.dataSource.transaction(async (em) => {
        const booking = await em
          .getRepository(Booking)
          .createQueryBuilder('b')
          .setLock('pessimistic_write')
          .where('b.id = :id', { id: String(bookingId) })
          .getOne();
        if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

        await assertBookingOperator(em, booking, actor, 'ASSIGN_ROOM');
        await assertCommittedEntitlement(em, booking);

        const expectedVer = input.expectedBookingVersion ?? input.expectedVersion;
        if (
          expectedVer !== undefined &&
          expectedVer !== null &&
          booking.version !== undefined &&
          Number(booking.version) !== Number(expectedVer)
        ) {
          throw new ConflictException('BOOKING_VERSION_MISMATCH');
        }

        if (
          booking.status === BookingStatus.CANCELLED ||
          booking.status === BookingStatus.COMPLETED ||
          (booking.status as string) === 'EXPIRED'
        ) {
          throw new ConflictException(`Không thể gán phòng vật lý cho booking ở trạng thái ${booking.status}.`);
        }

        const bookingRooms = await em.getRepository(BookingRoom).find({
          where: { bookingId: String(booking.id) },
        });
        const requiredQuantity =
          bookingRooms.reduce((sum, r) => sum + Number(r.quantity || 1), 0) ||
          Number(booking.requestedRoomCount || 1);

        if (uniqueUnitIds.length !== requiredQuantity) {
          throw new ConflictException(
            `Số lượng phòng vật lý (${uniqueUnitIds.length}) phải khớp với số phòng đã đặt (${requiredQuantity}).`,
          );
        }

        const units = await em
          .getRepository(RoomUnit)
          .createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.id IN (:...ids)', { ids: uniqueUnitIds })
          .orderBy('u.id', 'ASC')
          .getMany();

        if (units.length !== uniqueUnitIds.length) {
          throw new ConflictException('Thiếu phòng vật lý hoặc một số phòng không tồn tại.');
        }

        const needByType = new Map<string, number>();
        for (const l of bookingRooms) {
          needByType.set(String(l.roomId), (needByType.get(String(l.roomId)) || 0) + Number(l.quantity || 1));
        }
        const chosenByType = new Map<string, number>();
        for (const unit of units) {
          if (String(unit.hotelId) !== String(booking.hotelId) || unit.verificationStatus === 'UNVERIFIED') {
            throw new ConflictException(`Phòng vật lý #${unit.roomNumber} sai khách sạn hoặc chưa xác minh.`);
          }
          if (
            unit.operationalStatus !== RoomUnitOperationalStatus.ACTIVE &&
            unit.operationalStatus !== RoomUnitOperationalStatus.IN_SERVICE
          ) {
            throw new ConflictException(`Phòng vật lý #${unit.roomNumber} đang ở trạng thái ${unit.operationalStatus}.`);
          }
          chosenByType.set(String(unit.roomTypeId), (chosenByType.get(String(unit.roomTypeId)) || 0) + 1);
        }

        for (const [typeId, needed] of needByType.entries()) {
          if ((chosenByType.get(typeId) || 0) !== needed) {
            throw new ConflictException('Số unit không khớp số phòng đã mua theo từng loại phòng.');
          }
        }

        return this.persistStaySlotsAndAllocations(em, booking, bookingRooms, units, cmdId, actor.id);
      });
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        throw new ConflictException('ROOM_UNIT_OCCUPIED: Phòng vật lý đã được nhận cho đêm lưu trú này.');
      }
      throw err;
    }
  }

  private async persistStaySlotsAndAllocations(
    em: EntityManager,
    booking: Booking,
    bookingRooms: BookingRoom[],
    units: RoomUnit[],
    cmdId: string,
    actorId: string,
  ): Promise<RoomUnitAllocation[]> {
    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const stayNights = this.propertyClock.enumerateStayNights(
      booking.checkInAt,
      booking.checkOutAt,
      settings.ianaTimezone,
    );
    const checkInDate = stayNights[0];
    const checkOutDate = this.propertyClock.toLocalDateStr(booking.checkOutAt, settings.ianaTimezone);
    const uniqueUnitIds = units.map((u) => String(u.id));

    const conflictingSlots = await em.getRepository(RoomUnitStaySlot).find({
      where: {
        unitId: In(uniqueUnitIds),
        stayDate: In(stayNights),
        status: RoomUnitStaySlotStatus.ACTIVE,
      },
    });
    const externalConflict = conflictingSlots.find((s) => String(s.bookingId) !== String(booking.id));
    if (externalConflict) {
      throw new ConflictException(
        `ROOM_UNIT_STAY_DATE_CONFLICT: Phòng vật lý #${externalConflict.unitId} đã có khách vào đêm ${externalConflict.stayDate}.`,
      );
    }

    const savedAllocations: RoomUnitAllocation[] = [];
    for (let idx = 0; idx < units.length; idx++) {
      const unit = units[idx];
      const perUnitCmdId = idx === 0 ? cmdId : `${cmdId}:${unit.id}`;
      const alloc = em.getRepository(RoomUnitAllocation).create({
        bookingId: String(booking.id),
        bookingRoomId: bookingRooms[idx]?.id ? String(bookingRooms[idx].id) : bookingRooms[0]?.id ? String(bookingRooms[0].id) : null,
        hotelId: String(booking.hotelId),
        roomTypeId: String(unit.roomTypeId),
        roomUnitId: String(unit.id),
        status:
          booking.status === BookingStatus.CHECKED_IN
            ? RoomUnitAllocationStatus.CHECKED_IN
            : RoomUnitAllocationStatus.ASSIGNED,
        checkInDate,
        checkOutDate,
        assignedBy: String(actorId),
        assignedAt: new Date(),
        checkedInAt: booking.status === BookingStatus.CHECKED_IN ? new Date() : null,
        commandId: perUnitCmdId,
        version: 1,
      });
      const savedAlloc = await em.getRepository(RoomUnitAllocation).save(alloc);
      savedAllocations.push(savedAlloc);

      for (const stayDate of stayNights) {
        await em.getRepository(RoomUnitStaySlot).save(
          em.getRepository(RoomUnitStaySlot).create({
            allocationId: String(savedAlloc.id),
            bookingId: String(booking.id),
            hotelId: String(booking.hotelId),
            roomTypeId: String(unit.roomTypeId),
            unitId: String(unit.id),
            stayDate,
            status: RoomUnitStaySlotStatus.ACTIVE,
          }),
        );
      }
    }

    return savedAllocations;
  }

  async completeCheckoutAndMarkDirty(bookingId: string, em?: EntityManager): Promise<string[]> {
    const runner = em || this.dataSource.manager;
    const allocations = await this.getBookingAllocations(bookingId, runner);
    if (allocations.length === 0) return [];

    const unitIds: string[] = [];
    for (const alloc of allocations) {
      alloc.status = RoomUnitAllocationStatus.CHECKED_OUT;
      alloc.releasedAt = new Date();
      alloc.releaseReason = 'CHECKED_OUT';
      await runner.getRepository(RoomUnitAllocation).save(alloc);
      unitIds.push(String(alloc.roomUnitId));
    }

    await runner
      .getRepository(RoomUnitStaySlot)
      .update(
        { bookingId: String(bookingId), status: RoomUnitStaySlotStatus.ACTIVE },
        { status: RoomUnitStaySlotStatus.RELEASED },
      );

    await runner
      .getRepository(RoomUnit)
      .update(
        { id: In(unitIds) },
        { housekeepingState: RoomUnitHousekeepingState.DIRTY },
      );

    return unitIds;
  }
}
