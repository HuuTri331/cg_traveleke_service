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
    // 3. TÍNH SỐ PHÒNG ĐÃ ĐƯỢC GIỮ
    // ==========================================
    //
    // Chỉ tính:
    // PENDING
    // CONFIRMED
    // CHECKED_IN
    //
    // Không tính:
    // REJECTED
    // CANCELLED
    // COMPLETED
    //
    // Điều kiện overlap:
    //
    // booking.check_in_at < checkOut
    // AND
    // booking.check_out_at > checkIn
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
      }>();

    // ==========================================
    // 4. CHUYỂN DỮ LIỆU VỀ NUMBER
    // ==========================================

    const totalRooms = Number(room.totalRooms);

    const bookedRooms = Number(
      raw?.bookedRooms ?? 0,
    );

    // ==========================================
    // 5. TÍNH SỐ PHÒNG CÒN LẠI
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