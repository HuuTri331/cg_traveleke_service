import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Room } from '../rooms/entities/room.entity';
import { BookingStatus } from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';

export interface RoomAvailabilityResult {
  roomId: string;
  totalRooms: number;
  bookedRooms: number;
  remainingRooms: number;
  available: boolean;
  inHouseRooms?: number;
  noShowCommittedRooms?: number;
  sellableRooms?: number;
}

@Injectable()
export class RoomAvailabilityService {
  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,

    @InjectRepository(BookingRoom)
    private readonly bookingRoomRepository: Repository<BookingRoom>,
  ) {}

  /**
   * Kiểm tra số lượng phòng còn lại trong một khoảng thời gian.
   *
   * Hai khoảng thời gian bị trùng khi:
   *
   * booking.check_in_at < requestedCheckOut
   * AND
   * booking.check_out_at > requestedCheckIn
   */
  async getAvailability(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
  ): Promise<RoomAvailabilityResult> {
    // ==========================================
    // 1. KIỂM TRA NGÀY
    // ==========================================

    if (
      Number.isNaN(checkIn.getTime()) ||
      Number.isNaN(checkOut.getTime())
    ) {
      throw new BadRequestException(
        'Ngày nhận hoặc trả phòng không hợp lệ.',
      );
    }

    if (checkOut <= checkIn) {
      throw new BadRequestException(
        'Ngày trả phòng phải sau ngày nhận phòng.',
      );
    }

    // ==========================================
    // 2. TÌM ROOM
    // ==========================================

    const room = await this.roomRepository.findOne({
      where: {
        id: roomId,
      },
    });

    if (!room) {
      throw new NotFoundException(
        'Không tìm thấy phòng.',
      );
    }

    // ==========================================
    // 3. TÍNH SỐ PHÒNG ĐÃ ĐƯỢC GIỮ (D2-03: Bắt buộc tính cả NO_SHOW và đối chiếu booking_holds COMMITTED/HELD)
    // ==========================================
    //
    // Tính:
    // PENDING, CONFIRMED, CHECKED_IN, NO_SHOW (vì NO_SHOW vẫn giữ suất phòng đã thanh toán trong kỳ [checkInAt, checkOutAt))
    //
    // Không tính:
    // REJECTED, CANCELLED, COMPLETED, CLOSED_NO_SHOW, PAYMENT_EXPIRED
    // ==========================================

    const raw = await this.bookingRoomRepository
      .createQueryBuilder('bookingRoom')
      .innerJoin(
        'bookings',
        'booking',
        'booking.id = bookingRoom.booking_id',
      )
      .select(
        'COALESCE(SUM(bookingRoom.quantity), 0)',
        'bookedRooms',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN booking.status = 'CHECKED_IN' THEN bookingRoom.quantity ELSE 0 END), 0)`,
        'inHouseRooms',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN booking.status = 'NO_SHOW' THEN bookingRoom.quantity ELSE 0 END), 0)`,
        'noShowRooms',
      )
      .where(
        'bookingRoom.room_id = :roomId',
        {
          roomId,
        },
      )
      .andWhere(
        'booking.status IN (:...statuses)',
        {
          statuses: [
            BookingStatus.PENDING,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
            BookingStatus.NO_SHOW,
          ],
        },
      )
      .andWhere(
        'booking.check_in_at < :checkOut',
        {
          checkOut,
        },
      )
      .andWhere(
        'booking.check_out_at > :checkIn',
        {
          checkIn,
        },
      )
      .getRawOne<{
        bookedRooms: string | number | null;
        inHouseRooms?: string | number | null;
        noShowRooms?: string | number | null;
      }>();

    // Đối chiếu thêm với nguồn canonical booking_holds (COMMITTED + HELD còn hạn) nếu có
    let holdsOccupied = 0;
    try {
      const holdRows = await this.bookingRoomRepository.manager.query(
        `
        SELECT COALESCE(SUM(quantity), 0) AS occupied
        FROM booking_holds
        WHERE room_id = ?
          AND check_in_at < ?
          AND check_out_at > ?
          AND (status = 'COMMITTED' OR (status = 'HELD' AND hold_expires_at > NOW()))
        `,
        [roomId, checkOut, checkIn],
      );
      holdsOccupied = Number(holdRows?.[0]?.occupied ?? 0);
    } catch {
      holdsOccupied = 0;
    }

    // ==========================================
    // 4. CHUYỂN DỮ LIỆU VỀ NUMBER
    // ==========================================

    const totalRooms = Number(room.totalRooms);

    const statusBookedRooms = Number(raw?.bookedRooms ?? 0);
    const bookedRooms = Math.max(statusBookedRooms, holdsOccupied);
    const inHouseRooms = Number(raw?.inHouseRooms ?? 0);
    const noShowCommittedRooms = Number(raw?.noShowRooms ?? 0);

    // ==========================================
    // 5. TÍNH SỐ PHÒNG CÒN LẠI ĐƯỢC PHÉP BÁN (SELLABLE INVENTORY)
    // ==========================================

    const remainingRooms = Math.max(
      totalRooms - bookedRooms,
      0,
    );

    return {
      roomId: room.id,
      totalRooms,
      bookedRooms,
      remainingRooms,
      available: remainingRooms > 0,
      inHouseRooms,
      noShowCommittedRooms,
      sellableRooms: remainingRooms,
    };
  }

  /**
   * Kiểm tra một số lượng phòng cụ thể có thể đặt được hay không.
   *
   * Ví dụ:
   * remainingRooms = 3
   * requestedRooms = 2
   * => true
   */
  async canBook(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    requestedRooms: number,
  ): Promise<boolean> {
    if (
      !Number.isInteger(requestedRooms) ||
      requestedRooms < 1
    ) {
      throw new BadRequestException(
        'Số lượng phòng yêu cầu không hợp lệ.',
      );
    }

    const availability =
      await this.getAvailability(
        roomId,
        checkIn,
        checkOut,
      );

    return (
      requestedRooms <=
      availability.remainingRooms
    );
  }
}