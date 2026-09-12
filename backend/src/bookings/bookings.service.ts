import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  Repository,
} from 'typeorm';

import { Room } from '../rooms/entities/room.entity';

import { CreateBookingDto } from './dto/create-booking.dto';
import {
  Booking,
  BookingStatus,
} from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,

    @InjectRepository(BookingRoom)
    private readonly bookingRoomRepository: Repository<BookingRoom>,

    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,

    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateBookingDto) {
    // ==========================================
    // 1. TÌM PHÒNG
    // ==========================================

    const room = await this.roomRepository.findOne({
      where: {
        id: dto.roomId,
      },
    });

    if (!room) {
      throw new NotFoundException(
        'Không tìm thấy phòng.',
      );
    }

    // ==========================================
    // 2. KIỂM TRA NGÀY
    // ==========================================

    const checkIn = new Date(dto.checkInAt);
    const checkOut = new Date(dto.checkOutAt);

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
    // 3. TÍNH SỐ ĐÊM
    // ==========================================

    const diff =
      checkOut.getTime() -
      checkIn.getTime();

    const nights = Math.ceil(
      diff / (1000 * 60 * 60 * 24),
    );

    if (nights < 1) {
      throw new BadRequestException(
        'Số đêm phải lớn hơn hoặc bằng 1.',
      );
    }

    // ==========================================
    // 4. KIỂM TRA SỐ PHÒNG
    // ==========================================

    if (
      room.availableRooms !== undefined &&
      room.availableRooms !== null &&
      dto.roomCount > room.availableRooms
    ) {
      throw new BadRequestException(
        `Chỉ còn ${room.availableRooms} phòng.`,
      );
    }

    // ==========================================
    // 5. LẤY GIÁ TỪ DATABASE
    // ==========================================

    const pricePerNight = Number(
      room.pricePerNight,
    );

    if (
      Number.isNaN(pricePerNight) ||
      pricePerNight < 0
    ) {
      throw new BadRequestException(
        'Giá phòng không hợp lệ.',
      );
    }

    // ==========================================
    // 6. TÍNH TỔNG TIỀN
    // ==========================================

    const subtotal =
      pricePerNight *
      nights *
      dto.roomCount;

    // ==========================================
    // 7. SINH BOOKING CODE
    // ==========================================

    const bookingCode =
      `BK${Date.now()}`;

    // ==========================================
    // 8. TRANSACTION
    // ==========================================

    return this.dataSource.transaction(
      async (manager) => {
        const bookingRepo =
          manager.getRepository(Booking);

        const bookingRoomRepo =
          manager.getRepository(BookingRoom);

        // ======================================
        // INSERT BOOKINGS
        // ======================================

        const booking =
          bookingRepo.create({
            bookingCode,

            userId: dto.userId,

            hotelId: room.hotelId,

            tripPlanId: null,
            handledBy: null,

            contactName:
              dto.contactName,

            contactEmail:
              dto.contactEmail,

            contactPhone:
              dto.contactPhone,

            checkInAt: checkIn,
            checkOutAt: checkOut,

            totalGuests:
              dto.totalGuests,

            requestedRoomCount:
              dto.roomCount,

            estimatedTotal:
              subtotal.toFixed(2),

            status:
              BookingStatus.PENDING,

            specialRequest:
              dto.specialRequest ?? null,

            confirmedAt: null,
            rejectedAt: null,
            cancelledAt: null,
          });

        const savedBooking =
          await bookingRepo.save(
            booking,
          );

        // ======================================
        // INSERT BOOKING_ROOMS
        // ======================================

        const bookingRoom =
          bookingRoomRepo.create({
            bookingId:
              savedBooking.id,

            roomId:
              room.id,

            quantity:
              dto.roomCount,

            pricePerNight:
              pricePerNight.toFixed(2),

            nights,

            subtotal:
              subtotal.toFixed(2),
          });

        await bookingRoomRepo.save(
          bookingRoom,
        );

        return {
          message:
            'Đặt phòng thành công.',

          data: {
            booking:
              savedBooking,

            room: {
              id: room.id,
              name: room.name,
            },

            bookingRoom: {
              roomId:
                room.id,

              quantity:
                dto.roomCount,

              nights,

              pricePerNight,

              subtotal,
            },
          },
        };
      },
    );
  }

  async findOne(id: string) {
    const booking =
      await this.bookingRepository.findOne({
        where: {
          id,
        },
      });

    if (!booking) {
      throw new NotFoundException(
        'Không tìm thấy booking.',
      );
    }

    return {
      data: booking,
    };
  }

  async findByUser(userId: string) {
  const bookings =
    await this.dataSource.query(
      `
      SELECT
        b.id,
        b.booking_code AS bookingCode,
        b.user_id AS userId,
        b.hotel_id AS hotelId,

        b.contact_name AS contactName,
        b.contact_email AS contactEmail,
        b.contact_phone AS contactPhone,

        b.check_in_at AS checkInAt,
        b.check_out_at AS checkOutAt,

        b.total_guests AS totalGuests,
        b.requested_room_count AS requestedRoomCount,
        b.estimated_total AS estimatedTotal,

        b.status,
        b.special_request AS specialRequest,
        b.created_at AS createdAt,

        br.room_id AS roomId,
        br.quantity,
        br.price_per_night AS pricePerNight,
        br.nights,
        br.subtotal,

        r.name AS roomName,
        r.cover_image_url AS roomImage,

        h.name AS hotelName,
        h.address AS hotelAddress

      FROM bookings b

      LEFT JOIN booking_rooms br
        ON br.booking_id = b.id

      LEFT JOIN rooms r
        ON r.id = br.room_id

      LEFT JOIN hotels h
        ON h.id = b.hotel_id

      WHERE b.user_id = ?

      ORDER BY b.created_at DESC
      `,
      [userId],
    );

  return {
    message:
      'Lấy lịch sử đặt phòng thành công.',
    data: bookings,
  };
}
}