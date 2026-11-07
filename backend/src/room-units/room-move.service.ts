import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import {
  assertBookingOperator,
  assertCommittedEntitlement,
} from '../bookings/services/booking-operation-policy';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
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

export interface RoomMoveRequestDto {
  fromUnitId: string;
  toUnitId: string;
  moveType?: 'SAME_ROOM_TYPE' | 'COMPLIMENTARY_UPGRADE' | 'PAID_UPGRADE';
  priceDeltaVnd?: number;
  reason: string;
  approvedByManagerId?: string;
  commandId: string;
}

@Injectable()
export class RoomMoveService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  async previewMove(
    bookingId: string,
    dto: Omit<RoomMoveRequestDto, 'commandId'>,
    actor: { id: string; role: string },
  ) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    await assertBookingOperator(
      this.dataSource.manager,
      booking,
      actor,
      'ROOM_MOVE',
    );

    const [fromUnit, toUnit] = await Promise.all([
      this.dataSource.getRepository(RoomUnit).findOne({ where: { id: String(dto.fromUnitId) } }),
      this.dataSource.getRepository(RoomUnit).findOne({ where: { id: String(dto.toUnitId) } }),
    ]);
    if (!fromUnit || !toUnit) {
      throw new NotFoundException('Phòng vật lý nguồn hoặc đích không tồn tại.');
    }
    const isSameRoomType = String(fromUnit.roomTypeId) === String(toUnit.roomTypeId);
    return {
      bookingId: String(booking.id),
      fromUnitId: String(fromUnit.id),
      toUnitId: String(toUnit.id),
      isSameRoomType,
      requiresManagerApproval: !isSameRoomType,
      targetUnitReady:
        toUnit.operationalStatus === RoomUnitOperationalStatus.ACTIVE &&
        toUnit.housekeepingState === RoomUnitHousekeepingState.READY,
      priceDeltaVnd: isSameRoomType ? 0 : Number(dto.priceDeltaVnd || 0),
    };
  }

  async commitMove(
    bookingId: string,
    dto: RoomMoveRequestDto,
    actor: { id: string; role: string },
  ) {
    const cmdId = (dto.commandId || '').trim();
    if (!cmdId) throw new BadRequestException('commandId là bắt buộc khi chuyển phòng vật lý.');

    const existingEvt = await this.dataSource.getRepository(RoomUnitAllocationEvent).findOne({
      where: { commandId: cmdId },
    });
    if (existingEvt) return existingEvt;

    return this.dataSource.transaction(async (em) => {
      const booking = await em
        .getRepository(Booking)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.id = :id', { id: String(bookingId) })
        .getOne();
      if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

      await assertBookingOperator(
        em,
        booking,
        actor,
        'ROOM_MOVE',
      );
      await assertCommittedEntitlement(em, booking);

      const currentAlloc = await em.getRepository(RoomUnitAllocation).findOne({
        where: {
          bookingId: String(booking.id),
          roomUnitId: String(dto.fromUnitId),
          status: In([RoomUnitAllocationStatus.ASSIGNED, RoomUnitAllocationStatus.CHECKED_IN]),
        },
      });
      if (!currentAlloc) {
        throw new ConflictException(
          `Phòng nguồn #${dto.fromUnitId} hiện không phải là phòng đang gán cho booking #${booking.id}.`,
        );
      }

      const [fromUnit, toUnit] = await Promise.all([
        em.getRepository(RoomUnit).findOne({ where: { id: String(dto.fromUnitId) } }),
        em.getRepository(RoomUnit).findOne({ where: { id: String(dto.toUnitId) } }),
      ]);
      if (!fromUnit || !toUnit) {
        throw new NotFoundException('Phòng vật lý nguồn hoặc đích không tồn tại.');
      }
      if (String(toUnit.hotelId) !== String(booking.hotelId)) {
        throw new ForbiddenException('Phòng đích không thuộc khách sạn của booking.');
      }
      if (
        toUnit.operationalStatus !== RoomUnitOperationalStatus.ACTIVE ||
        toUnit.housekeepingState !== RoomUnitHousekeepingState.READY
      ) {
        throw new ConflictException(
          `TARGET_ROOM_NOT_READY: Phòng đích #${toUnit.roomNumber} đang ở trạng thái ${toUnit.operationalStatus}/${toUnit.housekeepingState}.`,
        );
      }

      return this.executeRoomMoveSwap(em, booking, currentAlloc, fromUnit, toUnit, dto, actor, cmdId);
    });
  }

  private async executeRoomMoveSwap(
    em: any,
    booking: Booking,
    currentAlloc: RoomUnitAllocation,
    fromUnit: RoomUnit,
    toUnit: RoomUnit,
    dto: RoomMoveRequestDto,
    actor: { id: string; role: string },
    cmdId: string,
  ) {
    const isDifferentRoomType = String(fromUnit.roomTypeId) !== String(toUnit.roomTypeId);
    if (toUnit.verificationStatus === 'UNVERIFIED') {
      throw new ConflictException(
        `TARGET_ROOM_UNVERIFIED: Phòng đích #${toUnit.roomNumber} chưa được xác minh (UNVERIFIED).`,
      );
    }
    if (isDifferentRoomType) {
      if (!dto.approvedByManagerId && !(dto as any).approvalRequestId && actor.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Chuyển sang loại phòng thương mại khác bắt buộc có phê duyệt của Quản lý khách sạn.',
        );
      }
      if (dto.moveType === 'PAID_UPGRADE' && Number(dto.priceDeltaVnd || 0) > 0) {
        throw new ConflictException(
          'PAID_UPGRADE_REQUIRES_AMENDMENT_SETTLEMENT: Nâng hạng có phí phải thanh toán Amendment trước khi chuyển phòng vật lý.',
        );
      }
      if (actor.role !== 'ADMIN' && typeof em?.query === 'function') {
        const mgrId = dto.approvedByManagerId?.trim();
        const appId = (dto as any).approvalRequestId?.trim();
        if (appId) {
          const [app] = await em.query(
            `SELECT id, hotel_id AS hotelId, booking_id AS bookingId, status
             FROM approval_requests WHERE id = ? LIMIT 1`,
            [appId],
          );
          if (
            !app ||
            app.status !== 'APPROVED' ||
            String(app.hotelId) !== String(booking.hotelId) ||
            (app.bookingId && String(app.bookingId) !== String(booking.id))
          ) {
            throw new ForbiddenException(
              'APPROVAL_BOOKING_MISMATCH: Quyết định phê duyệt không hợp lệ hoặc không thuộc booking này.',
            );
          }
        } else if (mgrId) {
          const mgrRows = await em.query(
            `SELECT hs.staff_user_id AS managerId FROM hotel_staff hs
             INNER JOIN users u ON u.id = hs.staff_user_id
             WHERE hs.hotel_id = ? AND hs.staff_user_id = ? AND hs.staff_role = 'MANAGER'
               AND hs.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL LIMIT 1`,
            [booking.hotelId, mgrId],
          );
          if (!Array.isArray(mgrRows) || mgrRows.length === 0) {
            throw new ForbiddenException(
              'INVALID_MANAGER_APPROVAL: Người duyệt nâng hạng không phải Quản lý ACTIVE của khách sạn này.',
            );
          }
          const approvalsForManager = await em.query(
            `SELECT id, booking_id AS bookingId FROM approval_requests
             WHERE hotel_id = ? AND reviewed_by = ? AND status = 'APPROVED'`,
            [booking.hotelId, mgrId],
          );
          if (
            Array.isArray(approvalsForManager) &&
            approvalsForManager.length > 0 &&
            !approvalsForManager.some((a: any) => !a.bookingId || String(a.bookingId) === String(booking.id))
          ) {
            throw new ForbiddenException(
              'APPROVAL_BOOKING_MISMATCH: Quyết định phê duyệt của Quản lý thuộc về một đơn đặt phòng khác.',
            );
          }
        }
      }
    }

    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const stayNights = this.propertyClock.enumerateStayNights(
      booking.checkInAt,
      booking.checkOutAt,
      settings.ianaTimezone,
    );

    const targetConflicts = await em.getRepository(RoomUnitStaySlot).find({
      where: {
        unitId: String(toUnit.id),
        stayDate: In(stayNights),
        status: RoomUnitStaySlotStatus.ACTIVE,
      },
    });
    if (targetConflicts.some((s: RoomUnitStaySlot) => String(s.bookingId) !== String(booking.id))) {
      throw new ConflictException(
        `ROOM_UNIT_STAY_DATE_CONFLICT: Phòng đích #${toUnit.roomNumber} đã có lịch phân bổ trùng đêm lưu trú.`,
      );
    }

    currentAlloc.status = RoomUnitAllocationStatus.MOVED_OUT;
    currentAlloc.releasedAt = new Date();
    currentAlloc.releaseReason = dto.reason || 'ROOM_MOVED';
    await em.getRepository(RoomUnitAllocation).save(currentAlloc);

    await em
      .getRepository(RoomUnitStaySlot)
      .update(
        { allocationId: String(currentAlloc.id), status: RoomUnitStaySlotStatus.ACTIVE },
        { status: RoomUnitStaySlotStatus.RELEASED },
      );

    if (booking.status === BookingStatus.CHECKED_IN) {
      fromUnit.housekeepingState = RoomUnitHousekeepingState.DIRTY;
      await em.getRepository(RoomUnit).save(fromUnit);
    }

    const newAlloc = await em.getRepository(RoomUnitAllocation).save(
      em.getRepository(RoomUnitAllocation).create({
        bookingId: String(booking.id),
        bookingRoomId: currentAlloc.bookingRoomId,
        hotelId: String(booking.hotelId),
        roomTypeId: String(toUnit.roomTypeId),
        roomUnitId: String(toUnit.id),
        status:
          booking.status === BookingStatus.CHECKED_IN
            ? RoomUnitAllocationStatus.CHECKED_IN
            : RoomUnitAllocationStatus.ASSIGNED,
        checkInDate: currentAlloc.checkInDate,
        checkOutDate: currentAlloc.checkOutDate,
        assignedBy: String(actor.id),
        assignedAt: new Date(),
        checkedInAt: booking.status === BookingStatus.CHECKED_IN ? new Date() : null,
        commandId: `${cmdId}:alloc`,
        version: 1,
      }),
    );

    for (const stayDate of stayNights) {
      await em.getRepository(RoomUnitStaySlot).save(
        em.getRepository(RoomUnitStaySlot).create({
          allocationId: String(newAlloc.id),
          bookingId: String(booking.id),
          hotelId: String(booking.hotelId),
          roomTypeId: String(toUnit.roomTypeId),
          unitId: String(toUnit.id),
          stayDate,
          status: RoomUnitStaySlotStatus.ACTIVE,
        }),
      );
    }

    return em.getRepository(RoomUnitAllocationEvent).save(
      em.getRepository(RoomUnitAllocationEvent).create({
        bookingId: String(booking.id),
        hotelId: String(booking.hotelId),
        allocationId: String(newAlloc.id),
        fromUnitId: String(fromUnit.id),
        toUnitId: String(toUnit.id),
        fromRoomTypeId: String(fromUnit.roomTypeId),
        toRoomTypeId: String(toUnit.roomTypeId),
        eventType: 'ROOM_MOVED',
        moveType: dto.moveType || (isDifferentRoomType ? 'COMPLIMENTARY_UPGRADE' : 'SAME_ROOM_TYPE'),
        priceDeltaVnd: 0,
        reason: dto.reason,
        actorId: String(actor.id),
        approvedBy: dto.approvedByManagerId || null,
        commandId: cmdId,
      }),
    );
  }
}
