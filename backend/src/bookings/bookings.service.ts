import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { Room } from '../rooms/entities/room.entity';

import { CreateBookingDto } from './dto/create-booking.dto';
import { QueryBookingDto } from './dto/query-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { Booking, BookingStatus } from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';
import { BookingStatusLog } from './entities/booking-status-log.entity';
import { IdGeneratorService } from '../common/id/id-generator.service';
import { logWithTrace } from '../observability/trace-logger';
import { normalizePagination, buildPaginationMeta } from '../common/pagination';
import { RealtimeGateway } from '../realtime/realtime.gateway';

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
  private readonly idGen: IdGeneratorService;

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
    @Optional() idGenerator?: IdGeneratorService,
    @Optional() private readonly realtimeGateway?: RealtimeGateway,
  ) {
    this.idGen = idGenerator ?? new IdGeneratorService();
  }

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
      throw new NotFoundException('Không tìm thấy phòng.');
    }

    // ==========================================
    // 2. KIỂM TRA NGÀY
    // ==========================================

    const checkIn = new Date(dto.checkInAt);
    const checkOut = new Date(dto.checkOutAt);

    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      throw new BadRequestException('Ngày nhận hoặc trả phòng không hợp lệ.');
    }

    if (checkOut <= checkIn) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }

    // ==========================================
    // 3. TÍNH SỐ ĐÊM
    // ==========================================

    const diff = checkOut.getTime() - checkIn.getTime();

    const nights = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (nights < 1) {
      throw new BadRequestException('Số đêm phải lớn hơn hoặc bằng 1.');
    }

    // ==========================================
    // 4. KIỂM TRA SỐ PHÒNG
    // ==========================================

    if (
      room.availableRooms !== undefined &&
      room.availableRooms !== null &&
      dto.roomCount > room.availableRooms
    ) {
      throw new BadRequestException(`Chỉ còn ${room.availableRooms} phòng.`);
    }

    // ==========================================
    // 5. LẤY GIÁ TỪ DATABASE
    // ==========================================

    const pricePerNight = Number(room.pricePerNight);

    if (Number.isNaN(pricePerNight) || pricePerNight < 0) {
      throw new BadRequestException('Giá phòng không hợp lệ.');
    }

    // ==========================================
    // 6. TÍNH TỔNG TIỀN
    // ==========================================

    const subtotal = pricePerNight * nights * dto.roomCount;

    // ==========================================
    // 7. SINH BOOKING CODE (Business Code thân thiện cho Lễ tân và Khách hàng)
    // ==========================================

    const bookingCode = this.idGen.generateBookingCode();

    // ==========================================
    // 8. TRANSACTION
    // ==========================================

    const result = await this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);

      const bookingRoomRepo = manager.getRepository(BookingRoom);

      // ======================================
      // INSERT BOOKINGS
      // ======================================

      const booking = bookingRepo.create({
        bookingCode,

        userId: dto.userId,

        hotelId: room.hotelId,

        tripPlanId: null,
        handledBy: null,

        contactName: dto.contactName,

        contactEmail: dto.contactEmail,

        contactPhone: dto.contactPhone,

        checkInAt: checkIn,
        checkOutAt: checkOut,

        totalGuests: dto.totalGuests,

        requestedRoomCount: dto.roomCount,

        estimatedTotal: subtotal.toFixed(2),

        status: BookingStatus.PENDING,

        specialRequest: dto.specialRequest ?? null,

        confirmedAt: null,
        rejectedAt: null,
        cancelledAt: null,
      });

      const savedBooking = await bookingRepo.save(booking);

      // ======================================
      // INSERT BOOKING_ROOMS
      // ======================================

      const bookingRoom = bookingRoomRepo.create({
        bookingId: savedBooking.id,

        roomId: room.id,

        quantity: dto.roomCount,

        pricePerNight: pricePerNight.toFixed(2),

        nights,

        subtotal: subtotal.toFixed(2),
      });

      await bookingRoomRepo.save(bookingRoom);

      // Tự động phân công ngầm nhân viên lễ tân phù hợp theo phân hạng phòng & năng lực
      await this.autoAssignHotelStaffInternal(savedBooking, room, manager);

      return {
        message: 'Đặt phòng thành công.',

        data: {
          booking: savedBooking,

          room: {
            id: room.id,
            name: room.name,
          },

          bookingRoom: {
            roomId: room.id,

            quantity: dto.roomCount,

            nights,

            pricePerNight,

            subtotal,
          },
        },
      };
    });

    // Phát realtime notification tới Lễ tân và Quản lý khách sạn
    try {
      this.realtimeGateway?.emitBookingCreated({
        id: result.data.booking.id,
        bookingCode: result.data.booking.bookingCode,
        hotelId: room.hotelId,
        userId: result.data.booking.userId,
        contactName: result.data.booking.contactName,
        contactPhone: result.data.booking.contactPhone,
        contactEmail: result.data.booking.contactEmail,
        checkInAt: checkIn.toISOString(),
        checkOutAt: checkOut.toISOString(),
        roomName: room.name,
        roomCount: dto.roomCount,
        estimatedTotal: result.data.booking.estimatedTotal,
        createdAt: result.data.booking.createdAt
          ? new Date(result.data.booking.createdAt).toISOString()
          : new Date().toISOString(),
      });
    } catch {
      // Realtime notification failure must never break the booking creation
    }

    return result;
  }

  /**
   * Tự động phân công ngầm nhân viên lễ tân dựa vào phân hạng phòng & năng lực nhân sự
   */
  private async autoAssignHotelStaffInternal(
    booking: Booking,
    room: Room,
    manager: any,
  ) {
    try {
      const isVipRoom =
        Number(room.pricePerNight) >= 1500000 ||
        /vip|suite|presidential|deluxe|luxury/i.test(room.name);

      // Truy vấn danh sách nhân sự của khách sạn này
      const staffList = await manager.query(
        `
        SELECT
          hs.staff_user_id AS staffUserId,
          u.full_name AS staffName,
          u.email AS staffEmail,
          hs.staff_role AS staffRole,
          COALESCE(MAX(ss.level), 1) AS maxSkillLevel,
          COALESCE(MAX(ss.years_exp), 0) AS maxYearsExp,
          (SELECT COUNT(*) FROM bookings b WHERE b.handled_by = hs.staff_user_id AND b.status = 'COMPLETED') AS completedCount,
          (SELECT COUNT(*) FROM bookings b WHERE b.handled_by = hs.staff_user_id AND b.status IN ('PENDING', 'CONFIRMED')) AS activeLoad
        FROM hotel_staff hs
        INNER JOIN users u ON u.id = hs.staff_user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        LEFT JOIN staff_skills ss ON ss.user_id = hs.staff_user_id
        WHERE hs.hotel_id = ? AND hs.status = 'ACTIVE'
        GROUP BY hs.staff_user_id, u.full_name, u.email, hs.staff_role
        `,
        [booking.hotelId],
      );

      let candidates = staffList;
      if (!candidates || candidates.length === 0) {
        // Fallback: Nếu khách sạn chưa gán nhân sự, tìm nhân sự khả dụng trong hệ thống
        candidates = await manager.query(
          `SELECT u.id AS staffUserId, u.full_name AS staffName, u.email AS staffEmail,
                  'EMPLOYEE' AS staffRole, 2 AS maxSkillLevel, 1 AS maxYearsExp, 0 AS completedCount, 0 AS activeLoad
           FROM users u
           WHERE u.role IN ('EMPLOYEE', 'ADMIN') AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
           LIMIT 5`,
        );
      }

      if (candidates && candidates.length > 0) {
        let bestCandidate: any = null;
        let reason = '';

        if (isVipRoom) {
          // Phòng VIP/Suite: Ưu tiên nhân sự có skill level cao, nhiều năm kinh nghiệm, thành tích tốt
          candidates.sort((a: any, b: any) => {
            const scoreA =
              Number(a.maxSkillLevel) * 20 +
              Number(a.maxYearsExp) * 10 +
              Number(a.completedCount) * 5 -
              Number(a.activeLoad) * 15 +
              (a.staffRole === 'MANAGER' ? 30 : 0);
            const scoreB =
              Number(b.maxSkillLevel) * 20 +
              Number(b.maxYearsExp) * 10 +
              Number(b.completedCount) * 5 -
              Number(b.activeLoad) * 15 +
              (b.staffRole === 'MANAGER' ? 30 : 0);
            return scoreB - scoreA;
          });
          bestCandidate = candidates[0];
          reason = `Hệ thống tự động phân công: Phòng cao cấp/VIP (${room.name}) được phân công nhân sự giàu kinh nghiệm (${bestCandidate.staffName} - Level ${bestCandidate.maxSkillLevel}, ${bestCandidate.maxYearsExp} năm KN, ${bestCandidate.completedCount} đơn hoàn thành).`;
        } else {
          // Phòng Standard/Economy: Ghép nối nhân sự tiêu chuẩn/junior để cọ xát và cân bằng tải
          candidates.sort((a: any, b: any) => {
            const scoreA =
              (5 - Number(a.maxSkillLevel)) * 20 +
              (Number(a.maxYearsExp) <= 2 ? 30 : 0) -
              Number(a.activeLoad) * 25;
            const scoreB =
              (5 - Number(b.maxSkillLevel)) * 20 +
              (Number(b.maxYearsExp) <= 2 ? 30 : 0) -
              Number(b.activeLoad) * 25;
            return scoreB - scoreA;
          });
          bestCandidate = candidates[0];
          reason = `Hệ thống tự động phân công: Phòng tiêu chuẩn/cơ bản (${room.name}) ghép nối nhân sự tiêu chuẩn (${bestCandidate.staffName} - Level ${bestCandidate.maxSkillLevel}) tối ưu phân bổ tải.`;
        }

        if (bestCandidate) {
          booking.handledBy = String(bestCandidate.staffUserId);
          booking.assignmentType = 'AUTO';
          booking.assignmentNote = reason;
          await manager.getRepository(Booking).save(booking);

          // Ghi nhận log
          await manager.getRepository(BookingStatusLog).save(
            manager.getRepository(BookingStatusLog).create({
              bookingId: booking.id,
              oldStatus: null,
              newStatus: BookingStatus.PENDING,
              note: reason,
              changedBy: String(bestCandidate.staffUserId),
            }),
          );
        }
      }
    } catch (err: any) {
      logWithTrace(
        'warn',
        'Lỗi phân công tự động phòng khách sạn (không chặn luồng chính)',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // ============================================================
  // DANH SÁCH BOOKINGS (Admin/Employee)
  // ============================================================

  async findAll(query: QueryBookingDto) {
    const { page, limit, skip, perPage } = normalizePagination(query, 20, 100);

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
        'b.assignment_type AS assignmentType',
        'b.assignment_note AS assignmentNote',
        'b.reassigned_at AS reassignedAt',
        'b.reassigned_by AS reassignedBy',
        'b.confirmed_at AS confirmedAt',
        'b.rejected_at AS rejectedAt',
        'b.cancelled_at AS cancelledAt',
        'b.created_at AS createdAt',
        'h.name AS hotelName',
        'h.address AS hotelAddress',
        'u.full_name AS customerName',
        'u.email AS customerEmail',
        'staff.full_name AS handledByName',
        'staff.email AS handledByEmail',
        'staff.role AS handledByRole',
      ])
      .from('bookings', 'b')
      .leftJoin('hotels', 'h', 'h.id = b.hotel_id')
      .leftJoin('users', 'u', 'u.id = b.user_id')
      .leftJoin('users', 'staff', 'staff.id = b.handled_by')
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

    // Phân trang an toàn với skip và limit đã được chuẩn hóa
    qb.offset(skip).limit(limit);

    const data = await qb.getRawMany();

    return {
      data,
      meta: buildPaginationMeta({
        page,
        limit,
        total,
        dataLength: data.length,
      }),
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
        b.assignment_type AS assignmentType,
        b.assignment_note AS assignmentNote,
        b.reassigned_at AS reassignedAt,
        b.reassigned_by AS reassignedBy,
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
        u.phone AS customerPhone,

        staff.full_name AS handledByName,
        staff.email AS handledByEmail,
        staff.role AS handledByRole

      FROM bookings b
      LEFT JOIN booking_rooms br ON br.booking_id = b.id
      LEFT JOIN rooms r ON r.id = br.room_id
      LEFT JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN users u ON u.id = b.user_id
      LEFT JOIN users staff ON staff.id = b.handled_by
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

    const bookingData = bookings[0];
    const canReassign =
      bookingData.status !== BookingStatus.CHECKED_IN &&
      bookingData.status !== BookingStatus.COMPLETED &&
      bookingData.status !== BookingStatus.CANCELLED &&
      bookingData.status !== BookingStatus.REJECTED;

    return {
      data: {
        ...bookingData,
        canReassign,
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
    if (!booking.handledBy) {
      booking.handledBy = changedByUserId;
    }

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

    // Phát realtime notification cập nhật trạng thái tới Khách hàng và Lễ tân
    try {
      this.realtimeGateway?.emitBookingStatusChanged({
        id: booking.id,
        bookingCode: booking.bookingCode,
        hotelId: booking.hotelId,
        userId: booking.userId,
        oldStatus: currentStatus,
        newStatus: newStatus,
        changedAt: now.toISOString(),
        note: dto.note ?? undefined,
      });
    } catch {
      // Fail-safe: Realtime error does not break status update
    }

    return {
      message: `Đã chuyển trạng thái booking ${booking.bookingCode} từ "${currentStatus}" sang "${newStatus}".`,
      data: booking,
    };
  }

  // ============================================================
  // PHÂN CÔNG LẠI NHÂN VIÊN PHỤ TRÁCH (Admin/Quản Lý Lễ Tân)
  // ============================================================

  async reassignStaff(
    bookingId: string,
    targetStaffUserId: string,
    changedByUserId: string,
    note?: string,
  ) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    // 1. KIỂM TRA ĐIỀU KIỆN TIÊN QUYẾT: CHỈ ĐỔI KHI KHÁCH CHƯA TỚI NHẬN PHÒNG
    if (booking.status === BookingStatus.CHECKED_IN) {
      throw new BadRequestException(
        'Không thể phân công lại nhân viên vì khách hàng đã tới nhận phòng (CHECKED_IN).',
      );
    }

    if (
      booking.status === BookingStatus.COMPLETED ||
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Không thể phân công lại cho đơn đặt phòng ở trạng thái ${booking.status}.`,
      );
    }

    // 2. KIỂM TRA NHÂN VIÊN ĐƯỢC CHỈ ĐỊNH
    const [targetStaff] = await this.dataSource.query(
      'SELECT id, full_name, email, role FROM users WHERE id = ? AND deleted_at IS NULL AND status = "ACTIVE"',
      [targetStaffUserId],
    );

    if (!targetStaff) {
      throw new NotFoundException('Không tìm thấy nhân viên được chỉ định.');
    }

    if (targetStaff.role === 'CUSTOMER') {
      throw new BadRequestException(
        'Không thể phân công khách hàng làm người phụ trách phục vụ.',
      );
    }

    // 3. CẬP NHẬT PHÂN CÔNG
    const oldStaffId = booking.handledBy;
    booking.handledBy = targetStaffUserId;
    booking.assignmentType = 'MANUAL';
    booking.assignmentNote =
      note ??
      `Quản lý/Admin đã phân công lại người phụ trách: ${targetStaff.full_name}`;
    booking.reassignedBy = changedByUserId;
    booking.reassignedAt = new Date();

    const saved = await this.bookingRepository.save(booking);

    // 4. GHI LOG VẬN HÀNH
    await this.bookingStatusLogRepository.save(
      this.bookingStatusLogRepository.create({
        bookingId: booking.id,
        oldStatus: booking.status,
        newStatus: booking.status,
        note: `[PHÂN CÔNG LẠI] Đổi nhân viên phụ trách từ #${oldStaffId ?? 'Chưa có'} sang ${targetStaff.full_name} (#${targetStaff.id}). Lý do: ${note || 'Quản trị viên điều chỉnh thủ công'}`,
        changedBy: changedByUserId,
      }),
    );

    // Thông báo realtime phân công lại tới Lễ tân / Quản lý
    try {
      this.realtimeGateway?.emitBookingStatusChanged({
        id: booking.id,
        bookingCode: booking.bookingCode,
        hotelId: booking.hotelId,
        userId: booking.userId,
        oldStatus: booking.status,
        newStatus: booking.status,
        changedAt: new Date().toISOString(),
        note: `Đã phân công lễ tân phụ trách: ${targetStaff.full_name}`,
      });
    } catch {
      // Fail-safe
    }

    return {
      message: `Đã phân công lại người phụ trách cho đơn đặt phòng #${booking.bookingCode} thành công.`,
      booking: saved,
      staff: {
        id: targetStaff.id,
        name: targetStaff.full_name,
        email: targetStaff.email,
      },
    };
  }

  // ============================================================
  // DANH SÁCH NHÂN VIÊN KHẢ DỤNG CHO ĐƠN ĐẶT PHÒNG
  // ============================================================

  async getAvailableStaffForBooking(bookingId: string) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    // Lấy thông tin phòng của booking
    const [room] = await this.dataSource.query(
      `SELECT r.id, r.name, r.price_per_night AS pricePerNight
       FROM booking_rooms br
       INNER JOIN rooms r ON r.id = br.room_id
       WHERE br.booking_id = ?
       LIMIT 1`,
      [bookingId],
    );

    const isVip =
      room &&
      (Number(room.pricePerNight) >= 1500000 ||
        /vip|suite|presidential|deluxe|luxury/i.test(room.name));

    // Lấy danh sách nhân sự thuộc khách sạn này kèm kỹ năng & thành tích
    const staffList = await this.dataSource.query(
      `
      SELECT
        hs.staff_user_id AS staffUserId,
        u.full_name AS staffName,
        u.email AS staffEmail,
        hs.staff_role AS staffRole,
        COALESCE(MAX(ss.level), 1) AS maxSkillLevel,
        COALESCE(MAX(ss.years_exp), 0) AS maxYearsExp,
        COALESCE(MAX(ss.eligibility_level), 'STANDARD') AS eligibilityLevel,
        (SELECT COUNT(*) FROM bookings b WHERE b.handled_by = hs.staff_user_id AND b.status = 'COMPLETED') AS completedCount,
        (SELECT COUNT(*) FROM bookings b WHERE b.handled_by = hs.staff_user_id AND b.status IN ('PENDING', 'CONFIRMED')) AS activeLoad
      FROM hotel_staff hs
      INNER JOIN users u ON u.id = hs.staff_user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      LEFT JOIN staff_skills ss ON ss.user_id = hs.staff_user_id
      WHERE hs.hotel_id = ? AND hs.status = 'ACTIVE'
      GROUP BY hs.staff_user_id, u.full_name, u.email, hs.staff_role
      ORDER BY maxSkillLevel DESC, completedCount DESC
      `,
      [booking.hotelId],
    );

    let candidates = staffList;
    if (!candidates || candidates.length === 0) {
      // Fallback nếu chưa có nhân viên được gán vào hotel_staff
      candidates = await this.dataSource.query(
        `SELECT u.id AS staffUserId, u.full_name AS staffName, u.email AS staffEmail,
                'EMPLOYEE' AS staffRole, 2 AS maxSkillLevel, 1 AS maxYearsExp, 'STANDARD' AS eligibilityLevel,
                0 AS completedCount, 0 AS activeLoad
         FROM users u
         WHERE u.role IN ('EMPLOYEE', 'ADMIN') AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         LIMIT 10`,
      );
    }

    return {
      bookingId,
      bookingCode: booking.bookingCode,
      currentHandledBy: booking.handledBy,
      assignmentType: booking.assignmentType,
      assignmentNote: booking.assignmentNote,
      roomInfo: room
        ? {
            name: room.name,
            pricePerNight: room.pricePerNight,
            isVip,
          }
        : null,
      canReassign:
        booking.status !== BookingStatus.CHECKED_IN &&
        booking.status !== BookingStatus.COMPLETED &&
        booking.status !== BookingStatus.CANCELLED &&
        booking.status !== BookingStatus.REJECTED,
      staff: candidates.map((s: any) => ({
        ...s,
        maxSkillLevel: Number(s.maxSkillLevel),
        maxYearsExp: Number(s.maxYearsExp),
        completedCount: Number(s.completedCount),
        activeLoad: Number(s.activeLoad),
        recommended: isVip
          ? Number(s.maxSkillLevel) >= 4 ||
            Number(s.maxYearsExp) >= 2 ||
            s.staffRole === 'MANAGER'
          : Number(s.maxSkillLevel) <= 3 && Number(s.activeLoad) <= 2,
      })),
    };
  }

  // ============================================================
  // LỊCH SỬ BOOKING CỦA USER (Customer)
  // ============================================================

  async findByUser(userId: string) {
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
      message: 'Lấy lịch sử đặt phòng thành công.',
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
    const safeLimit = Math.min(
      100,
      Math.max(1, Math.floor(Number(limit) || 50)),
    );

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
      [safeLimit],
    );

    return {
      message: 'Lấy nhật ký vận hành thành công.',
      data: logs,
    };
  }
}
