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
import { QueryBookingDto } from './dto/query-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import {
  Booking,
  BookingStatus,
} from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';
import { BookingStatusLog } from './entities/booking-status-log.entity';

/**
 * State machine: Các chuyển trạng thái hợp lệ cho booking.
 * Key = trạng thái hiện tại, Value = danh sách trạng thái có thể chuyển sang.
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['COMPLETED'],
  // Các trạng thái cuối: REJECTED, COMPLETED, CANCELLED → không chuyển tiếp được
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,

    @InjectRepository(BookingRoom)
    private readonly bookingRoomRepository: Repository<BookingRoom>,

    @InjectRepository(BookingStatusLog)
    private readonly bookingStatusLogRepository: Repository<BookingStatusLog>,

    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,

    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // TẠO BOOKING (Khách hàng)
  // ============================================================

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

  // ============================================================
  // DANH SÁCH BOOKINGS (Admin/Employee)
  // ============================================================

  async findAll(query: QueryBookingDto) {
    const page = Number(query.page) || 1;
    const perPage = Number(query.perPage) || 20;

    const qb = this.dataSource
      .createQueryBuilder()
      .select([
        'b.id AS id',
        'b.booking_code AS bookingCode',
        'b.user_id AS userId',
        'b.hotel_id AS hotelId',
        'b.contact_name AS contactName',
        'b.contact_email AS contactEmail',
        'b.contact_phone AS contactPhone',
        'b.check_in_at AS checkInAt',
        'b.check_out_at AS checkOutAt',
        'b.total_guests AS totalGuests',
        'b.requested_room_count AS requestedRoomCount',
        'b.estimated_total AS estimatedTotal',
        'b.status AS status',
        'b.special_request AS specialRequest',
        'b.handled_by AS handledBy',
        'b.confirmed_at AS confirmedAt',
        'b.rejected_at AS rejectedAt',
        'b.cancelled_at AS cancelledAt',
        'b.created_at AS createdAt',
        'h.name AS hotelName',
        'h.address AS hotelAddress',
        'u.full_name AS customerName',
        'u.email AS customerEmail',
      ])
      .from('bookings', 'b')
      .leftJoin('hotels', 'h', 'h.id = b.hotel_id')
      .leftJoin('users', 'u', 'u.id = b.user_id')
      .orderBy('b.created_at', 'DESC');

    // Filter theo status
    if (query.status) {
      qb.andWhere('b.status = :status', { status: query.status });
    }

    // Filter theo hotelId
    if (query.hotelId) {
      qb.andWhere('b.hotel_id = :hotelId', { hotelId: query.hotelId });
    }

    // Search theo booking_code, contact_name, contact_email, contact_phone
    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        `(
          b.booking_code LIKE :search
          OR b.contact_name LIKE :search
          OR b.contact_email LIKE :search
          OR b.contact_phone LIKE :search
          OR u.full_name LIKE :search
        )`,
        { search },
      );
    }

    // Đếm tổng
    const totalQuery = qb.clone();
    const totalResult = await totalQuery.select('COUNT(*) AS cnt').getRawOne();
    const total = Number(totalResult?.cnt || 0);

    // Phân trang
    qb.offset((page - 1) * perPage).limit(perPage);

    const data = await qb.getRawMany();

    return {
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  // ============================================================
  // CHI TIẾT BOOKING
  // ============================================================

  async findOne(id: string) {
    const bookings = await this.dataSource.query(
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
        b.handled_by AS handledBy,
        b.confirmed_at AS confirmedAt,
        b.rejected_at AS rejectedAt,
        b.cancelled_at AS cancelledAt,
        b.created_at AS createdAt,

        br.room_id AS roomId,
        br.quantity,
        br.price_per_night AS pricePerNight,
        br.nights,
        br.subtotal,

        r.name AS roomName,
        r.cover_image_url AS roomImage,

        h.name AS hotelName,
        h.address AS hotelAddress,
        h.cover_image_url AS hotelImage,

        u.full_name AS customerName,
        u.email AS customerEmail,
        u.phone AS customerPhone

      FROM bookings b
      LEFT JOIN booking_rooms br ON br.booking_id = b.id
      LEFT JOIN rooms r ON r.id = br.room_id
      LEFT JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
      `,
      [id],
    );

    if (!bookings || bookings.length === 0) {
      throw new NotFoundException('Không tìm thấy booking.');
    }

    // Lấy lịch sử trạng thái
    const statusLogs = await this.dataSource.query(
      `
      SELECT
        bsl.id,
        bsl.old_status AS oldStatus,
        bsl.new_status AS newStatus,
        bsl.note,
        bsl.changed_at AS changedAt,
        u.full_name AS changedByName
      FROM booking_status_logs bsl
      LEFT JOIN users u ON u.id = bsl.changed_by
      WHERE bsl.booking_id = ?
      ORDER BY bsl.changed_at DESC
      `,
      [id],
    );

    return {
      data: {
        ...bookings[0],
        statusLogs,
      },
    };
  }

  // ============================================================
  // CẬP NHẬT TRẠNG THÁI BOOKING (Admin/Employee)
  // ============================================================

  async updateStatus(
    bookingId: string,
    dto: UpdateBookingStatusDto,
    changedByUserId: string,
  ) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy booking.');
    }

    const currentStatus = booking.status;
    const newStatus = dto.status;

    // Kiểm tra state machine
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] ?? [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái từ "${currentStatus}" sang "${newStatus}". ` +
        `Các trạng thái hợp lệ: [${allowedTransitions.join(', ')}].`,
      );
    }

    // Cập nhật trạng thái và timestamps tương ứng
    booking.status = newStatus as unknown as BookingStatus;
    booking.handledBy = changedByUserId;

    const now = new Date();
    switch (newStatus) {
      case 'CONFIRMED':
        booking.confirmedAt = now;
        break;
      case 'REJECTED':
        booking.rejectedAt = now;
        break;
      case 'CANCELLED':
        booking.cancelledAt = now;
        break;
    }

    await this.bookingRepository.save(booking);

    // Ghi log thay đổi trạng thái
    const statusLog = this.bookingStatusLogRepository.create({
      bookingId: booking.id,
      changedBy: changedByUserId,
      oldStatus: currentStatus,
      newStatus: newStatus,
      note: dto.note ?? null,
    });

    await this.bookingStatusLogRepository.save(statusLog);

    return {
      message: `Đã chuyển trạng thái booking ${booking.bookingCode} từ "${currentStatus}" sang "${newStatus}".`,
      data: booking,
    };
  }

  // ============================================================
  // LỊCH SỬ BOOKING CỦA USER (Customer)
  // ============================================================

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

  // ============================================================
  // THỐNG KÊ DASHBOARD (Admin/Employee)
  // ============================================================

  async getStatistics() {
    const [bookingStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS totalBookings,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pendingBookings,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmedBookings,
        SUM(CASE WHEN status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS checkedInBookings,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedBookings,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedBookings,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledBookings,
        COALESCE(SUM(estimated_total), 0) AS totalRevenue
      FROM bookings
    `);

    const [monthlyStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS monthlyBookings,
        COALESCE(SUM(estimated_total), 0) AS monthlyRevenue
      FROM bookings
      WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
        AND YEAR(created_at) = YEAR(CURRENT_DATE())
    `);

    const [hotelCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM hotels WHERE deleted_at IS NULL
    `);

    const [roomCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM rooms WHERE deleted_at IS NULL
    `);

    const [customerCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL
    `);

    return {
      data: {
        totalHotels: Number(hotelCount?.total || 0),
        totalRooms: Number(roomCount?.total || 0),
        totalCustomers: Number(customerCount?.total || 0),
        totalBookings: Number(bookingStats?.totalBookings || 0),
        pendingBookings: Number(bookingStats?.pendingBookings || 0),
        confirmedBookings: Number(bookingStats?.confirmedBookings || 0),
        checkedInBookings: Number(bookingStats?.checkedInBookings || 0),
        completedBookings: Number(bookingStats?.completedBookings || 0),
        rejectedBookings: Number(bookingStats?.rejectedBookings || 0),
        cancelledBookings: Number(bookingStats?.cancelledBookings || 0),
        totalRevenue: Number(bookingStats?.totalRevenue || 0),
        monthlyBookings: Number(monthlyStats?.monthlyBookings || 0),
        monthlyRevenue: Number(monthlyStats?.monthlyRevenue || 0),
      },
    };
  }

  // ============================================================
  // NHẬT KÝ VẬN HÀNH / ACTIVITY LOGS (Admin/Employee)
  // ============================================================
  async getActivityLogs(limit = 50) {
    const logs = await this.dataSource.query(
      `
      SELECT
        bsl.id,
        bsl.booking_id AS bookingId,
        b.booking_code AS bookingCode,
        b.contact_name AS customerName,
        h.name AS hotelName,
        bsl.old_status AS oldStatus,
        bsl.new_status AS newStatus,
        bsl.note,
        bsl.changed_at AS changedAt,
        u.full_name AS operatorName,
        u.email AS operatorEmail,
        u.role AS operatorRole
      FROM booking_status_logs bsl
      LEFT JOIN bookings b ON b.id = bsl.booking_id
      LEFT JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN users u ON u.id = bsl.changed_by
      ORDER BY bsl.changed_at DESC
      LIMIT ?
      `,
      [limit],
    );

    return {
      message: 'Lấy nhật ký vận hành thành công.',
      data: logs,
    };
  }
}