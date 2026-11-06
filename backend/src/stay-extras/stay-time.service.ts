import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking } from '../bookings/entities/booking.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { RoomUnitAllocation, RoomUnitAllocationStatus } from '../room-units/entities/room-unit-allocation.entity';
import { RoomUnitStaySlot, RoomUnitStaySlotStatus } from '../room-units/entities/room-unit-stay-slot.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';

export interface StayTimeRequestInput {
  bookingId: string;
  requestType: 'EARLY_CHECKIN' | 'LATE_CHECKOUT' | 'EXTRA_NIGHT';
  requestedTime: string | Date;
  feeVnd?: number;
  isComplimentary?: boolean;
  commandId: string;
}

@Injectable()
export class StayTimeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  async requestStayTimeExtension(
    input: StayTimeRequestInput,
    actor: { id: string; role: string },
  ) {
    if (input.requestType === 'EXTRA_NIGHT') {
      throw new BadRequestException(
        'EXTRA_NIGHT_REQUIRES_AMENDMENT: Kéo dài lưu trú thêm đêm phải thực hiện qua quy trình Booking Amendment (IMP-05), không đổi trực tiếp giờ trả phòng.',
      );
    }

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(input.bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${input.bookingId} không tồn tại.`);

    if (String(booking.userId) !== String(actor.id)) {
      await assertBookingOperator(
        this.dataSource.manager,
        booking,
        actor,
        'STAY_TIME_EXTENSION',
      );
    }

    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const checkOutDate = this.propertyClock.toLocalDateStr(booking.checkOutAt, settings.ianaTimezone);

    // Check next booking collision on assigned room unit if LATE_CHECKOUT
    if (input.requestType === 'LATE_CHECKOUT') {
      const allocs = await this.dataSource.getRepository(RoomUnitAllocation).find({
        where: {
          bookingId: String(booking.id),
          status: In([RoomUnitAllocationStatus.ASSIGNED, RoomUnitAllocationStatus.CHECKED_IN]),
        },
      });
      const unitIds = allocs.map((a) => String(a.roomUnitId));
      if (unitIds.length > 0) {
        const nextArrivalSlots = await this.dataSource.getRepository(RoomUnitStaySlot).find({
          where: {
            unitId: In(unitIds),
            stayDate: checkOutDate,
            status: RoomUnitStaySlotStatus.ACTIVE,
          },
        });
        if (nextArrivalSlots.some((s) => String(s.bookingId) !== String(booking.id))) {
          throw new ConflictException(
            'LATE_CHECKOUT_COLLISION: Phòng vật lý đã có khách kế tiếp nhận phòng trong cùng ngày, không thể duyệt trả phòng muộn.',
          );
        }
      }
    }

    return {
      bookingId: String(booking.id),
      hotelId: String(booking.hotelId),
      requestType: input.requestType,
      requestedTime: new Date(input.requestedTime).toISOString(),
      feeVnd: input.isComplimentary ? 0 : Math.round(Number(input.feeVnd || 0)),
      status: 'APPROVED',
      commandId: input.commandId,
    };
  }
}
