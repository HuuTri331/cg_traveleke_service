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

    const actorRole = String(actor?.role || '').toUpperCase();
    const isCustomerActor = actorRole === 'CUSTOMER' || actorRole === 'USER';
    if (isCustomerActor && (input.isComplimentary !== undefined || input.feeVnd !== undefined)) {
      throw new BadRequestException(
        'CUSTOMER_CANNOT_SET_PRICING_OR_APPROVAL: Khách hàng không được tự quy định mức phí hoặc tự duyệt miễn phí gia hạn giờ lưu trú.',
      );
    }

    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const checkInDate = this.propertyClock.toLocalDateStr(booking.checkInAt, settings.ianaTimezone);
    const checkOutDate = this.propertyClock.toLocalDateStr(booking.checkOutAt, settings.ianaTimezone);

    let normalizedIso: string;
    if (input.requestedTime instanceof Date) {
      if (Number.isNaN(input.requestedTime.getTime())) {
        throw new BadRequestException('INVALID_REQUESTED_TIME: Thời gian yêu cầu không hợp lệ.');
      }
      normalizedIso = input.requestedTime.toISOString();
    } else {
      const rawTime = String(input.requestedTime ?? '').trim();
      if (!rawTime) {
        throw new BadRequestException('INVALID_REQUESTED_TIME: Thời gian yêu cầu không được để trống.');
      }
      const hhmmMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(rawTime);
      if (hhmmMatch) {
        const hh = Number(hhmmMatch[1]);
        const mm = Number(hhmmMatch[2]);
        const ss = Number(hhmmMatch[3] || '0');
        if (hh > 23 || mm > 59 || ss > 59) {
          throw new BadRequestException('INVALID_REQUESTED_TIME: Giờ phút yêu cầu nằm ngoài phạm vi 00:00 - 23:59.');
        }
        const baseDate = input.requestType === 'EARLY_CHECKIN' ? checkInDate : checkOutDate;
        const hhStr = String(hh).padStart(2, '0');
        const mmStr = String(mm).padStart(2, '0');
        const ssStr = String(ss).padStart(2, '0');
        const tzOffset = settings.ianaTimezone === 'Asia/Ho_Chi_Minh' ? '+07:00' : 'Z';
        const candidateDate = new Date(`${baseDate}T${hhStr}:${mmStr}:${ssStr}${tzOffset}`);
        if (Number.isNaN(candidateDate.getTime())) {
          throw new BadRequestException('INVALID_REQUESTED_TIME: Không thể quy đổi giờ địa phương của khách sạn.');
        }
        normalizedIso = candidateDate.toISOString();
      } else {
        const parsedDate = new Date(rawTime);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new BadRequestException(
            'INVALID_REQUESTED_TIME: Thời gian yêu cầu phải có định dạng ISO-8601 hoặc HH:mm hợp lệ.',
          );
        }
        normalizedIso = parsedDate.toISOString();
      }
    }

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

    const status = isCustomerActor ? 'REQUESTED' : 'APPROVED';
    const feeVnd = isCustomerActor
      ? 0
      : input.isComplimentary
        ? 0
        : Math.round(Number(input.feeVnd || 0));

    if (typeof this.dataSource?.query === 'function') {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS stay_time_requests (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          booking_id BIGINT UNSIGNED NOT NULL,
          hotel_id BIGINT UNSIGNED NOT NULL,
          requested_by BIGINT UNSIGNED NOT NULL,
          request_type VARCHAR(30) NOT NULL,
          requested_time DATETIME NOT NULL,
          fee_vnd BIGINT NOT NULL DEFAULT 0,
          is_complimentary TINYINT(1) NOT NULL DEFAULT 0,
          status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
          command_id VARCHAR(120) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_stay_time_cmd (command_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      await this.dataSource.query(
        `INSERT INTO stay_time_requests (
           booking_id, hotel_id, requested_by, request_type, requested_time,
           fee_vnd, is_complimentary, status, command_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           requested_time = VALUES(requested_time),
           fee_vnd = VALUES(fee_vnd),
           status = VALUES(status)`,
        [
          booking.id,
          booking.hotelId,
          actor.id,
          input.requestType,
          new Date(normalizedIso),
          feeVnd,
          !isCustomerActor && input.isComplimentary ? 1 : 0,
          status,
          input.commandId,
        ],
      );
    }

    return {
      bookingId: String(booking.id),
      hotelId: String(booking.hotelId),
      requestType: input.requestType,
      requestedTime: normalizedIso,
      feeVnd,
      status,
      commandId: input.commandId,
    };
  }
}
