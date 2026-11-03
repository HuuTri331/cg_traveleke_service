import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';

import { Room } from '../rooms/entities/room.entity';

import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateFrontDeskBookingDto } from './dto/create-front-desk-booking.dto';
import { QueryBookingDto } from './dto/query-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { Booking, BookingStatus } from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';
import { BookingStatusLog } from './entities/booking-status-log.entity';
import { IdGeneratorService } from '../common/id/id-generator.service';
import { logWithTrace } from '../observability/trace-logger';
import { normalizePagination, buildPaginationMeta } from '../common/pagination';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RedisLockService } from '../redis/redis-lock.service';
import {
  runWithDeadlockRetry,
  deterministicSort,
} from '../common/database/transaction-retry.helper';
import { BookingAccessService } from './services/booking-access.service';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { BookingPresenceService } from '../booking-presence/booking-presence.service';
import { InventoryService } from '../inventory/inventory.service';
import { User } from '../users/entities/user.entity';
import {
  BenefitKind,
  PromotionCampaign,
  PromotionCampaignStatus,
} from '../promotions/entities/promotion-campaign.entity';
import { BookingPriceQuote } from '../promotions/entities/booking-price-quote.entity';
import {
  BenefitAccountStatus,
  BookingBenefitAccount,
} from '../promotions/entities/booking-benefit-account.entity';
import {
  BenefitLedgerEntryType,
  BookingBenefitLedger,
} from '../promotions/entities/booking-benefit-ledger.entity';
import { OutboxEvent, OutboxEventStatus } from '../outbox/entities/outbox-event.entity';
import { computeNightlyQuote, hasRemainingCampaignBudget } from '../promotions/promotion-engine';

import {
  BookingPresenceEvent,
  PresenceEventType,
  PresenceActorType,
} from '../booking-presence/entities/booking-presence-event.entity';
import {
  BookingAssignment,
  AssignmentType,
} from '../booking-assignment/entities/booking-assignment.entity';
import {
  BookingAssignmentState,
  AssignmentStateStatus,
} from '../booking-assignment/entities/booking-assignment-state.entity';

/**
 * State machine: Các chuyển trạng thái hợp lệ cho booking.
 * Key = trạng thái hiện tại, Value = danh sách trạng thái có thể chuyển sang.
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  // Đơn chưa thanh toán có thể chuyển sang PENDING (khi IPN), hết hạn, xem xét hoặc hủy đơn chưa trả tiền
  PAYMENT_PENDING: ['PENDING', 'PAYMENT_EXPIRED', 'PAYMENT_REVIEW', 'CANCELLED'],
  // Đơn đã thanh toán (PENDING, CONFIRMED): KHÔNG được hủy trực tiếp bằng updateStatus()
  // Việc hủy và hoàn tiền BẮT BUỘC phải qua quy trình CancellationsService.reviewRequest(APPROVE)
  PENDING: ['CONFIRMED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'NO_SHOW'],
  NO_SHOW: ['CHECKED_IN', 'CLOSED_NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  CLOSED_NO_SHOW: [],
  PAYMENT_REVIEW: [],
  // Các trạng thái cuối: REJECTED, COMPLETED, CANCELLED, PAYMENT_EXPIRED → không chuyển tiếp được
  PAYMENT_EXPIRED: [],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

import { PaymentsService } from '../payments/payments.service';

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
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redisClient?: Redis,
    @Optional()
    private readonly redisLockService?: RedisLockService,
    @Optional()
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService?: PaymentsService,
    @Optional()
    private readonly bookingAccessService?: BookingAccessService,
    @Optional()
    private readonly inventoryService?: InventoryService,
    @Optional()
    private readonly bookingCoverageService?: BookingCoverageService,
    @Optional()
    private readonly bookingPresenceService?: BookingPresenceService,
  ) {
    this.idGen = idGenerator ?? new IdGeneratorService();
  }

  async retryPayment(bookingId: string, userId: string, clientIp = '127.0.0.1') {
    if (!this.paymentsService) {
      throw new BadRequestException('Dịch vụ thanh toán chưa sẵn sàng.');
    }
    return this.paymentsService.retryPayment(bookingId, userId, clientIp);
  }

  // ============================================================
  // TẠO BOOKING (Khách hàng)
  // ============================================================

  async create(dto: CreateBookingDto, clientIp = '127.0.0.1') {
    if (this.paymentsService && dto.userId) {
      const session = await this.paymentsService.createCheckoutSession(
        dto,
        dto.userId,
        clientIp,
      );
      return {
        message: 'Tạo đơn đặt phòng thành công, vui lòng tiến hành thanh toán.',
        data: session,
      };
    }

    throw new BadRequestException('Dịch vụ checkout chưa sẵn sàng. Không tạo booking website ngoài luồng thanh toán.');
  }

  // ============================================================
  // DANH SÁCH BOOKINGS (Admin/Employee)
  // ============================================================

  async findAll(query: QueryBookingDto, actor?: User) {
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
        '(SELECT pt.status FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paymentStatus',
        '(SELECT pt.vnp_transaction_no FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS vnpTransactionNo',
        '(SELECT pt.amount FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paidAmount',
        '(SELECT bh.status FROM booking_holds bh WHERE bh.booking_id = b.id LIMIT 1) AS holdStatus',
      ])
      .from('bookings', 'b')
      .leftJoin('hotels', 'h', 'h.id = b.hotel_id')
      .leftJoin('users', 'u', 'u.id = b.user_id')
      .leftJoin('users', 'staff', 'staff.id = b.handled_by')
      .orderBy('b.created_at', 'DESC');

    if (actor && actor.role === 'EMPLOYEE') {
      if (query.hotelId && typeof this.dataSource?.query === 'function') {
        const [membership] = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [query.hotelId, actor.id],
        );
        if (!membership) {
          throw new ForbiddenException('Bạn không thuộc nhân sự đang hoạt động tại khách sạn này.');
        }
      }
      qb.andWhere(
        `b.hotel_id IN (SELECT hs.hotel_id FROM hotel_staff hs WHERE hs.staff_user_id = :actorId AND hs.status = 'ACTIVE')`,
        { actorId: actor.id },
      );
    }

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

  async findOne(id: string, user?: User) {
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
        b.actual_check_in_at AS actualCheckInAt,
        b.actual_check_out_at AS actualCheckOutAt,
        b.no_show_at AS noShowAt,
        b.no_show_closed_at AS noShowClosedAt,
        b.late_arrival_expected_at AS lateArrivalExpectedAt,
        b.late_arrival_note AS lateArrivalNote,
        b.presence_version AS presenceVersion,

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
        staff.role AS handledByRole,

        (SELECT pt.status FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paymentStatus,
        (SELECT pt.vnp_transaction_no FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS vnpTransactionNo,
        (SELECT pt.amount FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paidAmount,
        (SELECT pt.paid_at FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paidAt,
        (SELECT bh.status FROM booking_holds bh WHERE bh.booking_id = b.id LIMIT 1) AS holdStatus

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

    const bookingData = bookings[0];

    // Resource authorization check
    if (user && this.bookingAccessService) {
      await this.bookingAccessService.assertCanView(
        { userId: bookingData.userId, hotelId: bookingData.hotelId },
        user,
      );
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

    const canReassign =
      [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.NO_SHOW, BookingStatus.CHECKED_IN].includes(bookingData.status);

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
    user?: User,
  ) {
    // Legacy PATCH status endpoint delegates presence transitions to BookingPresenceService.
    if (this.bookingPresenceService && ['CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CLOSED_NO_SHOW'].includes(dto.status)) {
      const role = user?.role || 'EMPLOYEE';
      if (dto.status === 'CHECKED_IN') {
        const res = await this.bookingPresenceService.confirmArrival(bookingId, changedByUserId, role, { note: dto.note });
        return { message: res.message, data: res.booking };
      }
      if (dto.status === 'COMPLETED') {
        const res = await this.bookingPresenceService.confirmDeparture(bookingId, changedByUserId, role, { note: dto.note });
        return { message: res.message, data: res.booking };
      }
      if (dto.status === 'NO_SHOW') {
        const updated = await this.bookingPresenceService.markNoShowIfEligible(
          bookingId, dto.note, { id: changedByUserId, role });
        return { message: 'Cập nhật trạng thái thành công.', data: updated };
      }
      const updated = await this.bookingPresenceService.closeExpiredNoShow(bookingId, true);
      return { message: 'Cập nhật trạng thái thành công.', data: updated };
    }

    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const bookingRoomRepo = manager.getRepository(BookingRoom);
        const statusLogRepo = manager.getRepository(BookingStatusLog);

        const booking = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!booking) {
          throw new NotFoundException('Không tìm thấy booking.');
        }

        if (user && this.bookingAccessService) {
          await this.bookingAccessService.assertCanManage(booking, user);
        }

        const currentStatus = booking.status;
        const newStatus = dto.status;

        // PAID booking cannot be rejected directly (Section 6)
        if (currentStatus === BookingStatus.PENDING && newStatus === 'REJECTED') {
          throw new BadRequestException(
            'Đơn hàng đã thanh toán không thể từ chối trực tiếp. Vui lòng sử dụng quy trình Yêu cầu Hủy / Hoàn tiền (Cancellation Request).',
          );
        }

        // Kiểm tra state machine
        const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] ?? [];
        if (!allowedTransitions.includes(newStatus)) {
          throw new BadRequestException(
            `Không thể chuyển trạng thái từ "${currentStatus}" sang "${newStatus}". ` +
              `Các trạng thái hợp lệ: [${allowedTransitions.join(', ')}].`,
          );
        }

        // ==========================================
        // HOÀN TRẢ TỒN KHO PHÒNG (COMMITTED -> RELEASED) (Section 5)
        // Không dùng rooms.available_rooms global
        // ==========================================
        if (newStatus === 'CANCELLED') {
          if (currentStatus === 'PAYMENT_PENDING') {
            if (this.inventoryService) {
              await this.inventoryService.releaseHold(
                booking.id,
                dto.note || 'Khách hủy đơn chưa thanh toán',
                manager,
              );
            }
          } else {
            throw new BadRequestException(
              `Đơn đặt phòng ở trạng thái "${currentStatus}" không thể hủy trực tiếp qua cập nhật trạng thái. Vui lòng sử dụng quy trình yêu cầu hủy đơn (Cancellation Workflow) để xét duyệt và hoàn tiền.`,
            );
          }
        }

        // Cập nhật trạng thái và timestamps tương ứng
        booking.status = newStatus as unknown as BookingStatus;

        const now = new Date();
        const presenceRepo = manager.getRepository(BookingPresenceEvent);

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
          default:
            throw new BadRequestException('Trạng thái hiện diện phải xử lý qua BookingPresenceService.');
        }

        const savedBooking = await bookingRepo.save(booking);

        // Ghi log thay đổi trạng thái trong cùng transaction
        const statusLog = statusLogRepo.create({
          bookingId: booking.id,
          changedBy: changedByUserId,
          actorType: 'USER',
          oldStatus: currentStatus,
          newStatus: newStatus,
          note: dto.note ?? null,
        });

        await statusLogRepo.save(statusLog);

        return {
          savedBooking,
          currentStatus,
          newStatus,
          now,
        };
      },
      {
        contextName: 'BookingsService.updateStatus',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    // Phát realtime notification cập nhật trạng thái tới Khách hàng và Lễ tân (NGOÀI TRANSACTION)
    try {
      this.realtimeGateway?.emitBookingStatusChanged({
        id: result.savedBooking.id,
        bookingCode: result.savedBooking.bookingCode,
        hotelId: result.savedBooking.hotelId,
        userId: result.savedBooking.userId,
        oldStatus: result.currentStatus,
        newStatus: result.newStatus,
        changedAt: result.now.toISOString(),
        note: dto.note ?? undefined,
      });
    } catch {
      // Fail-safe: Realtime error does not break status update
    }

    return {
      message: `Đã chuyển trạng thái booking ${result.savedBooking.bookingCode} từ "${result.currentStatus}" sang "${result.newStatus}".`,
      data: result.savedBooking,
    };
  }

  // ============================================================
  // PHÂN CÔNG LẠI NHÂN VIÊN PHỤ TRÁCH (Admin/Quản Lý Lễ Tân)
  // ============================================================

  async reassignStaff(
    bookingId: string, targetStaffUserId: string, changedByUserId: string, note?: string, actor?: User,
  ) {
    if (!this.bookingCoverageService) {
      throw new BadRequestException('Dịch vụ bàn giao phụ trách chưa sẵn sàng.');
    }
    const [staffRow] = await this.dataSource.query(
      `SELECT u.id, u.full_name AS name, u.email FROM users u WHERE u.id = ? LIMIT 1`, [targetStaffUserId]);
    const transferred = await this.bookingCoverageService.transferPermanent(
      bookingId,
      { id: String(actor?.id || changedByUserId), role: actor?.role || 'EMPLOYEE' },
      {
        toStaffUserId: targetStaffUserId,
        reasonCode: 'MANUAL_REASSIGN',
        reason: note || `Quản lý/Admin điều chỉnh người phụ trách sang ${staffRow?.name || targetStaffUserId}`,
      },
    );
    return {
      message: `Đã phân công lại người phụ trách cho đơn đặt phòng #${transferred.booking.bookingCode} thành công.`,
      booking: transferred.booking,
      staff: { id: targetStaffUserId, name: staffRow?.name || '', email: staffRow?.email || '' },
    };
  }

  // ============================================================
  // DANH SÁCH NHÂN VIÊN KHẢ DỤNG CHO ĐƠN ĐẶT PHÒNG
  // ============================================================

  async getAvailableStaffForBooking(bookingId: string, actor?: User) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    if (actor && this.bookingAccessService) {
      await this.bookingAccessService.assertCanView(booking, actor);
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

    // Section 11.3: Danh sách ứng viên CHỈ lấy từ nhân sự thuộc đúng khách sạn này. Tuyệt đối không query toàn hệ thống!
    const candidates = staffList || [];

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
        [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.NO_SHOW, BookingStatus.CHECKED_IN].includes(booking.status),
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

  async findByUser(userId: string, actor?: User) {
    let sqlCondition = 'WHERE b.user_id = ?';
    const params: any[] = [userId];

    if (actor && actor.role === 'EMPLOYEE') {
      sqlCondition +=
        ' AND b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = "ACTIVE")';
      params.push(actor.id);
    }

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
        b.actual_check_in_at AS actualCheckInAt,
        b.actual_check_out_at AS actualCheckOutAt,
        b.no_show_at AS noShowAt,
        b.no_show_closed_at AS noShowClosedAt,
        b.late_arrival_expected_at AS lateArrivalExpectedAt,
        b.late_arrival_note AS lateArrivalNote,
        b.presence_version AS presenceVersion,

        br.room_id AS roomId,
        br.quantity,
        br.price_per_night AS pricePerNight,
        br.nights,
        br.subtotal,

        r.name AS roomName,
        r.cover_image_url AS roomImage,

        h.name AS hotelName,
        h.address AS hotelAddress,

        (SELECT pt.status FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS paymentStatus,
        (SELECT pt.vnp_transaction_no FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS vnpTransactionNo,
        (SELECT pt.gateway_expire_at FROM payment_transactions pt WHERE pt.booking_id = b.id ORDER BY pt.attempt_no DESC LIMIT 1) AS gatewayExpireAt,
        (SELECT bh.hold_expires_at FROM booking_holds bh WHERE bh.booking_id = b.id LIMIT 1) AS holdExpiresAt,
        (SELECT bh.status FROM booking_holds bh WHERE bh.booking_id = b.id LIMIT 1) AS holdStatus

      FROM bookings b

      LEFT JOIN booking_rooms br
        ON br.booking_id = b.id

      LEFT JOIN rooms r
        ON r.id = br.room_id

      LEFT JOIN hotels h
        ON h.id = b.hotel_id

      ${sqlCondition}

      ORDER BY b.created_at DESC
      `,
      params,
    );

    return {
      message: 'Lấy lịch sử đặt phòng thành công.',
      data: bookings,
    };
  }

  // ============================================================
  // THỐNG KÊ DASHBOARD (Admin/Employee)
  // ============================================================

  async getStatistics(actor?: User) {
    const isEmployee = Boolean(actor && actor.role === 'EMPLOYEE');
    const hotelWhere = isEmployee
      ? `WHERE hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')`
      : '';
    const hotelAnd = isEmployee
      ? `AND hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')`
      : '';
    const params = isEmployee ? [actor!.id] : [];

    const [bookingStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS totalBookings,
        SUM(CASE WHEN status = 'PAYMENT_PENDING' THEN 1 ELSE 0 END) AS paymentPendingBookings,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pendingBookings,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmedBookings,
        SUM(CASE WHEN status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS checkedInBookings,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedBookings,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedBookings,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledBookings,
        SUM(CASE WHEN status = 'PAYMENT_EXPIRED' THEN 1 ELSE 0 END) AS paymentExpiredBookings,
        SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) AS noShowBookings,
        SUM(CASE WHEN status = 'CLOSED_NO_SHOW' THEN 1 ELSE 0 END) AS closedNoShowBookings
      FROM bookings ${hotelWhere}
    `, params);

    const [salesAttribution] = await this.dataSource.query(`
      SELECT
        COALESCE(SUM(estimated_total), 0) AS estimatedGrossBookingValue,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CLOSED_NO_SHOW') THEN estimated_total ELSE 0 END), 0) AS bookedSales,
        COALESCE(SUM(CASE WHEN status IN ('CHECKED_IN', 'COMPLETED') THEN estimated_total ELSE 0 END), 0) AS realizedRevenue,
        COALESCE(SUM(CASE WHEN booking_source IN ('WALK_IN', 'PHONE') AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CLOSED_NO_SHOW') THEN estimated_total ELSE 0 END), 0) AS directFrontDeskSales,
        COALESCE(SUM(CASE WHEN (booking_source IS NULL OR booking_source = 'WEBSITE') AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CLOSED_NO_SHOW') THEN estimated_total ELSE 0 END), 0) AS websiteSales
      FROM bookings ${hotelWhere}
    `, params);

    const [revenueStats] = await this.dataSource.query(`
      SELECT
        COALESCE(SUM(CASE WHEN pt.status = 'PAID' THEN pt.amount ELSE 0 END) - SUM(pt.refund_amount), 0) AS totalRevenue
      FROM payment_transactions pt
      INNER JOIN bookings b ON b.id = pt.booking_id
      ${isEmployee ? `WHERE b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')` : ''}
    `, params);

    const [monthlyStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS monthlyBookings
      FROM bookings
      WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
        AND YEAR(created_at) = YEAR(CURRENT_DATE())
        ${hotelAnd}
    `, params);

    const [monthlyRevenueStats] = await this.dataSource.query(`
      SELECT
        COALESCE(SUM(CASE WHEN pt.status = 'PAID' THEN pt.amount ELSE 0 END) - SUM(pt.refund_amount), 0) AS monthlyRevenue
      FROM payment_transactions pt
      INNER JOIN bookings b ON b.id = pt.booking_id
      WHERE MONTH(pt.created_at) = MONTH(CURRENT_DATE())
        AND YEAR(pt.created_at) = YEAR(CURRENT_DATE())
        ${isEmployee ? `AND b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')` : ''}
    `, params);

    const [hotelCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM hotels WHERE deleted_at IS NULL
      ${isEmployee ? `AND id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')` : ''}
    `, params);

    const [roomCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM rooms WHERE deleted_at IS NULL
      ${hotelAnd}
    `, params);

    const [customerCount] = await this.dataSource.query(`
      SELECT COUNT(*) AS total FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL
    `);

    return {
      data: {
        totalHotels: Number(hotelCount?.total || 0),
        totalRooms: Number(roomCount?.total || 0),
        totalCustomers: Number(customerCount?.total || 0),
        totalBookings: Number(bookingStats?.totalBookings || 0),
        paymentPendingBookings: Number(bookingStats?.paymentPendingBookings || 0),
        pendingBookings: Number(bookingStats?.pendingBookings || 0),
        confirmedBookings: Number(bookingStats?.confirmedBookings || 0),
        checkedInBookings: Number(bookingStats?.checkedInBookings || 0),
        completedBookings: Number(bookingStats?.completedBookings || 0),
        rejectedBookings: Number(bookingStats?.rejectedBookings || 0),
        cancelledBookings: Number(bookingStats?.cancelledBookings || 0),
        paymentExpiredBookings: Number(bookingStats?.paymentExpiredBookings || 0),
        noShowBookings: Number(bookingStats?.noShowBookings || 0),
        closedNoShowBookings: Number(bookingStats?.closedNoShowBookings || 0),
        totalRevenue: Number(revenueStats?.totalRevenue || 0),
        cashCollected: Number(revenueStats?.totalRevenue || 0),
        estimatedGrossBookingValue: Number(salesAttribution?.estimatedGrossBookingValue || 0),
        bookedSales: Number(salesAttribution?.bookedSales || 0),
        realizedRevenue: Number(salesAttribution?.realizedRevenue || 0),
        directFrontDeskSales: Number(salesAttribution?.directFrontDeskSales || 0),
        websiteSales: Number(salesAttribution?.websiteSales || 0),
        monthlyBookings: Number(monthlyStats?.monthlyBookings || 0),
        monthlyRevenue: Number(monthlyRevenueStats?.monthlyRevenue || 0),
      },
    };
  }

  /**
   * Kiểm tra quan hệ quản lý trực tiếp giữa Manager và Staff trong cùng khách sạn
   */
  async isManagerOfUser(managerUserId: string | number, targetUserId: string | number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT m.id 
       FROM hotel_staff m
       INNER JOIN hotel_staff s ON s.hotel_id = m.hotel_id
       WHERE m.staff_user_id = ? AND m.staff_role = 'MANAGER' AND m.status = 'ACTIVE'
         AND s.staff_user_id = ? AND s.status = 'ACTIVE'
       LIMIT 1`,
      [managerUserId, targetUserId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Section 18 & 21: Báo cáo hiệu suất & KPI Lễ tân
   * Tách rõ: Doanh số trực tiếp (Walk-in/Phone) vs Booking phục vụ (Web/OTA) vs Dịch vụ bán thêm (Upsell)
   */
  async getStaffPerformance(staffUserId: string, actorUser?: User, hotelId?: string) {
    if (actorUser && actorUser.role !== 'ADMIN') {
      if (hotelId) {
        const [targetInHotel] = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [hotelId, staffUserId],
        );
        if (!targetInHotel) {
          throw new ForbiddenException('Nhân sự được tra cứu không thuộc biên chế đang hoạt động tại khách sạn này.');
        }
      }
      if (String(actorUser.id) !== String(staffUserId)) {
        if (hotelId) {
          const [mgrInHotel] = await this.dataSource.query(
            `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
            [hotelId, actorUser.id],
          );
          if (!mgrInHotel) {
            throw new ForbiddenException('Chỉ Quản lý của khách sạn này mới có quyền xem báo cáo hiệu suất nhân viên.');
          }
        } else {
          const isMgr = await this.isManagerOfUser(actorUser.id, staffUserId);
          if (!isMgr) {
            throw new ForbiddenException(
              'Bạn chỉ có thể xem báo cáo hiệu suất của chính mình hoặc của nhân viên dưới quyền.',
            );
          }
        }
      } else if (hotelId) {
        const [selfInHotel] = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [hotelId, actorUser.id],
        );
        if (!selfInHotel) {
          throw new ForbiddenException('Bạn không thuộc nhân sự đang hoạt động tại khách sạn này.');
        }
      }
    }

    const isScopedEmployee = Boolean(actorUser && actorUser.role === 'EMPLOYEE');
    const bookingHotelScopeSql = hotelId
      ? ' AND hotel_id = ?'
      : isScopedEmployee
      ? ` AND hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')`
      : '';
    const bookingHotelScopeParams = hotelId ? [hotelId] : isScopedEmployee ? [actorUser!.id] : [];

    // 1. Direct Sales (Walk-in / Phone tạo bởi lễ tân này trong phạm vi khách sạn được phép)
    const [directSales] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) AS directBookingsCount,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN estimated_total ELSE 0 END), 0) AS directSalesNet,
        COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN estimated_total ELSE 0 END), 0) AS directCancelledAmount
      FROM bookings
      WHERE created_by_staff_id = ?${bookingHotelScopeSql}
      `,
      [staffUserId, ...bookingHotelScopeParams],
    );

    // 2. Operational Volume (Số lượng booking lễ tân tiếp nhận & phục vụ check-in/out trong phạm vi khách sạn)
    const [operationalVolume] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) AS totalHandledBookings,
        COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN estimated_total ELSE 0 END), 0) AS handledVolumeAmount,
        SUM(CASE WHEN status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS checkedInCount,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedCount
      FROM bookings
      WHERE handled_by = ?${bookingHotelScopeSql}
      `,
      [staffUserId, ...bookingHotelScopeParams],
    );

    // 3. Service Upsells (Yêu cầu dịch vụ giao cho lễ tân xử lý / bán thêm trong phạm vi khách sạn)
    const [serviceUpsell] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) AS totalServiceRequests,
        SUM(CASE WHEN sr.status IN ('COMPLETED', 'CONFIRMED') THEN 1 ELSE 0 END) AS completedServicesCount,
        COALESCE(SUM(CASE WHEN sr.status IN ('COMPLETED', 'CONFIRMED') THEN sr.total_price ELSE 0 END), 0) AS completedServiceAmount,
        SUM(CASE WHEN sr.is_sla_breached = 1 THEN 1 ELSE 0 END) AS slaBreachedCount
      FROM service_requests sr
      INNER JOIN bookings b ON b.id = sr.booking_id
      WHERE sr.assigned_to = ?${
        hotelId
          ? ' AND b.hotel_id = ?'
          : isScopedEmployee
          ? ` AND b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')`
          : ''
      }
      `,
      [staffUserId, ...bookingHotelScopeParams],
    );

    // 4. Shift & Attendance (Ca trực và chênh lệch tiền mặt trong phạm vi khách sạn)
    const [shiftStats] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) AS totalShifts,
        SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closedShifts,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS openShifts,
        COALESCE(SUM(cash_variance), 0) AS totalCashVariance
      FROM staff_shifts
      WHERE staff_user_id = ?${bookingHotelScopeSql}
      `,
      [staffUserId, ...bookingHotelScopeParams],
    );

    // 5. Thông tin nhân viên
    const [staffInfo] = await this.dataSource.query(
      `SELECT id, full_name AS fullName, email, role, phone FROM users WHERE id = ? LIMIT 1`,
      [staffUserId],
    );

    const totalRequests = Number(serviceUpsell?.totalServiceRequests || 0);
    const completedServices = Number(serviceUpsell?.completedServicesCount || 0);
    const slaBreached = Number(serviceUpsell?.slaBreachedCount || 0);

    return {
      staff: staffInfo ?? { id: staffUserId },
      directSales: {
        bookingsCount: Number(directSales?.directBookingsCount || 0),
        netAmount: Number(directSales?.directSalesNet || 0),
        cancelledAmount: Number(directSales?.directCancelledAmount || 0),
      },
      operations: {
        totalHandledBookings: Number(operationalVolume?.totalHandledBookings || 0),
        handledVolumeAmount: Number(operationalVolume?.handledVolumeAmount || 0),
        checkedInCount: Number(operationalVolume?.checkedInCount || 0),
        completedCount: Number(operationalVolume?.completedCount || 0),
      },
      services: {
        totalRequests,
        completedCount: completedServices,
        totalUpsellAmount: Number(serviceUpsell?.completedServiceAmount || 0),
        slaBreachedCount: slaBreached,
        onTimeRate:
          totalRequests > 0
            ? Math.max(0, Math.round(((completedServices - slaBreached) / totalRequests) * 100))
            : 100,
      },
      shifts: {
        totalShifts: Number(shiftStats?.totalShifts || 0),
        closedShifts: Number(shiftStats?.closedShifts || 0),
        openShifts: Number(shiftStats?.openShifts || 0),
        totalCashVariance: Number(shiftStats?.totalCashVariance || 0),
      },
    };
  }

  // ============================================================
  // NHẬT KÝ VẬN HÀNH / ACTIVITY LOGS (Admin/Employee)
  // ============================================================
  async getActivityLogs(limit = 50, actor?: User) {
    const safeLimit = Math.min(
      100,
      Math.max(1, Math.floor(Number(limit) || 50)),
    );
    const isEmployee = Boolean(actor && actor.role === 'EMPLOYEE');

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
      ${isEmployee ? `WHERE b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE')` : ''}
      ORDER BY bsl.changed_at DESC
      LIMIT ?
      `,
      isEmployee ? [actor!.id, safeLimit] : [safeLimit],
    );

    return {
      message: 'Lấy nhật ký vận hành thành công.',
      data: logs,
    };
  }

  // ============================================================
  // TẠO BOOKING TẠI QUẦY / QUA ĐIỆN THOẠI (Lễ tân / Front Desk)
  // Section 02.14, 16.1, 17.2, 17.3, 30.3
  // ============================================================
  async createFrontDeskBooking(
    dto: CreateFrontDeskBookingDto,
    staffUser: User,
    ip: string,
  ) {
    // 1. Kiểm tra phòng tồn tại
    const room = await this.roomRepository.findOne({
      where: { id: dto.roomId },
    });

    if (!room) {
      throw new NotFoundException('Không tìm thấy phòng đã chọn.');
    }

    let hotelName = 'Khách sạn';
    if (room.hotelId) {
      const [h] = await this.dataSource.query(
        `SELECT name FROM hotels WHERE id = ? LIMIT 1`,
        [room.hotelId],
      );
      if (h?.name) hotelName = h.name;
    }

    // 2. Kiểm tra quyền nhân viên: Phải là ADMIN hoặc nhân sự ACTIVE tại khách sạn của phòng này
    if (staffUser.role !== 'ADMIN') {
      const isStaffAtHotel = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [room.hotelId, staffUser.id],
      );
      if (!isStaffAtHotel || isStaffAtHotel.length === 0) {
        throw new ForbiddenException(
          'Bạn không có quyền tạo đơn đặt phòng tại khách sạn này. Yêu cầu thuộc biên chế khách sạn.',
        );
      }
    }

    // 3. Kiểm tra ngày nhận & trả phòng
    const checkIn = new Date(dto.checkInAt);
    const checkOut = new Date(dto.checkOutAt);
    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      throw new BadRequestException('Định dạng ngày nhận/trả phòng không hợp lệ.');
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }

    if (!this.inventoryService) throw new BadRequestException('Dịch vụ tồn phòng chưa sẵn sàng.');

    // PP-P1-01 & Lỗi 10: Dùng chung động cơ tính giá theo đêm & khuyến mãi (computeNightlyQuote), fail-closed nếu query lỗi
    const pricePerNight = Number(room.pricePerNight);
    let activeCampaigns: PromotionCampaign[] = [];
    if (typeof this.dataSource.getRepository === 'function') {
      const promoRepo = this.dataSource.getRepository(PromotionCampaign);
      if (promoRepo && typeof promoRepo.find === 'function') {
        activeCampaigns = await promoRepo.find({
          where: { hotelId: String(room.hotelId), status: PromotionCampaignStatus.ACTIVE },
        });
      }
    }

    const quoteCalc = computeNightlyQuote({
      hotelId: String(room.hotelId),
      roomId: String(room.id),
      baseRatePerNight: pricePerNight,
      roomQuantity: dto.roomCount,
      totalGuests: dto.totalGuests || 1,
      checkInAt: checkIn,
      checkOutAt: checkOut,
      activeCampaigns,
    });
    const nights = quoteCalc.nightsCount;
    const subtotal = quoteCalc.payableTotal;

    // 6. Tìm hoặc tạo khách hàng theo email (Lỗi 29: Dùng mật khẩu ngẫu nhiên băm bcrypt, không lưu hằng số FRONT_DESK_NO_LOGIN)
    let customerUserId: string = staffUser.id;
    const normalizedEmail = dto.contactEmail.trim().toLowerCase();
    const [existingCustomer] = await this.dataSource.query(
      `SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
      [normalizedEmail],
    );

    if (existingCustomer) {
      customerUserId = String(existingCustomer.id);
    } else {
      const randomWalkInSecret = `WALKIN_${randomUUID()}_${randomBytes(16).toString('hex')}`;
      const hashedWalkInPassword = await bcrypt.hash(randomWalkInSecret, 10);
      const insertUser = await this.dataSource.query(
        `INSERT INTO users (full_name, email, phone, password, role, status, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'CUSTOMER', 'INACTIVE', NULL, NOW(), NOW())`,
        [dto.contactName.trim(), normalizedEmail, dto.contactPhone.trim(), hashedWalkInPassword],
      );
      customerUserId = String(insertUser.insertId);
    }

    // 7. Sinh booking code
    const bookingCode = this.idGen.generateBookingCode();

    // 8. Transaction lưu booking & decrement room
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager) => {
        const noteText = dto.note
          ? `Ghi chú: ${dto.note}`
          : dto.callReference
          ? `Mã cuộc gọi: ${dto.callReference}`
          : '';

        const booking = manager.getRepository(Booking).create({
          bookingCode,
          userId: customerUserId,
          hotelId: room.hotelId,
          handledBy: staffUser.id,
          createdByStaffId: staffUser.id,
          bookingSource: dto.bookingSource,
          assignmentType: 'FRONT_DESK',
          assignmentNote: `Đơn tạo trực tiếp tại khách sạn bởi Lễ tân ${staffUser.fullName} (Nguồn: ${dto.bookingSource}). ${noteText}`.trim(),
          contactName: dto.contactName.trim(),
          contactEmail: dto.contactEmail.trim(),
          contactPhone: dto.contactPhone.trim(),
          checkInAt: checkIn,
          checkOutAt: checkOut,
          totalGuests: dto.totalGuests,
          requestedRoomCount: dto.roomCount,
          estimatedTotal: String(subtotal),
          status: BookingStatus.CONFIRMED,
          specialRequest: dto.specialRequest,
          confirmedAt: new Date(),
        });

        const savedBooking = await manager.getRepository(Booking).save(booking);
        // Same room row lock and interval capacity as website. No global decrement.
        await this.inventoryService!.createInitialHold({
          bookingId: savedBooking.id, roomId: room.id, quantity: dto.roomCount,
          checkInAt: checkIn, checkOutAt: checkOut,
        }, manager);
        const committed = await this.inventoryService!.commitHold(savedBooking.id, manager);
        if (!committed) throw new ConflictException('Không thể chốt giữ phòng tại quầy.');


        const bookingRoom = manager.getRepository(BookingRoom).create({
          bookingId: savedBooking.id,
          roomId: room.id,
          quantity: dto.roomCount,
          pricePerNight: pricePerNight.toFixed(2),
          nights,
          subtotal: subtotal.toFixed(2),
        });
        await manager.getRepository(BookingRoom).save(bookingRoom);

        // PP-P1-01, FIX-10 & FIX-22: Khóa ngân sách campaign, lưu snapshot báo giá và cấp quyền lợi gói/quota trong CÙNG transaction, fail-closed (KHÔNG bọc try/catch rỗng)
        if (typeof manager.getRepository === 'function') {
          const consumedAtIso = new Date().toISOString();
          const committedCampaigns = (quoteCalc.appliedCampaigns || []).map((ac: any) => ({
            ...ac,
            budgetConsumedAt: consumedAtIso,
          }));
          const quoteRepo = manager.getRepository(BookingPriceQuote);
          if (quoteRepo && typeof quoteRepo.save === 'function') {
            await quoteRepo.save(
              quoteRepo.create({
                quoteCode: `QT-${savedBooking.bookingCode}`,
                hotelId: String(room.hotelId),
                bookingId: savedBooking.id,
                userId: customerUserId,
                roomId: String(room.id),
                roomQuantity: dto.roomCount,
                totalGuests: dto.totalGuests || 1,
                checkInLocalDate: quoteCalc.checkInLocalDate,
                checkOutLocalDate: quoteCalc.checkOutLocalDate,
                nightsCount: quoteCalc.nightsCount,
                baseTotal: quoteCalc.baseTotal,
                discountTotal: quoteCalc.discountTotal,
                payableTotal: quoteCalc.payableTotal,
                currency: 'VND',
                hotelTimezone: 'Asia/Ho_Chi_Minh',
                priceHash: quoteCalc.priceHash,
                nightlyLines: quoteCalc.nightlyLines,
                appliedCampaigns: committedCampaigns,
                status: 'CONFIRMED',
                expiresAt: new Date(Date.now() + 15 * 60 * 1000),
                confirmedAt: new Date(),
                version: 1,
              }),
            );
          }
          if (quoteCalc.appliedCampaigns?.length) {
            const campRepo = manager.getRepository(PromotionCampaign);
            if (campRepo && typeof campRepo.findOne === 'function') {
              for (const applied of quoteCalc.appliedCampaigns) {
                const lockedCamp = await campRepo.findOne({
                  where: { id: applied.campaignId },
                  lock: { mode: 'pessimistic_write' },
                });
                if (!lockedCamp || lockedCamp.status !== PromotionCampaignStatus.ACTIVE) {
                  throw new ConflictException(
                    'PRICE_CHANGED: Chương trình khuyến mãi vừa tạm dừng hoặc kết thúc, vui lòng tính lại giá tại quầy.',
                  );
                }
                const discAmt = Math.max(0, Math.round(Number(applied.discountAmount || 0)));
                if (!hasRemainingCampaignBudget(lockedCamp, discAmt)) {
                  throw new ConflictException(
                    'PROMO_BUDGET_EXHAUSTED: Ngân sách hoặc số lượt áp dụng chương trình khuyến mãi đã hết.',
                  );
                }
                lockedCamp.budgetConsumed = Number(lockedCamp.budgetConsumed || 0) + discAmt;
                lockedCamp.redemptionsCount = Number(lockedCamp.redemptionsCount || 0) + 1;
                await campRepo.save(lockedCamp);

                // FIX-22: Cấp ngay quyền lợi gói/tín dụng dịch vụ (SERVICE_BENEFIT_CREDIT / INCLUDED_QUOTA) cho đơn tại quầy
                const totalQuota = (lockedCamp.packageConfig?.includedQuotas || []).reduce(
                  (s, q) => s + Number(q.quantity || 0),
                  0,
                );
                const isServiceBenefit =
                  lockedCamp.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT ||
                  lockedCamp.benefitKind === BenefitKind.INCLUDED_QUOTA ||
                  totalQuota > 0;
                const creditAmt = lockedCamp.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT ? discAmt : 0;
                const accRepo = manager.getRepository(BookingBenefitAccount);
                const ledgerRepo = manager.getRepository(BookingBenefitLedger);

                if (isServiceBenefit && (creditAmt > 0 || totalQuota > 0) && accRepo && typeof accRepo.save === 'function') {
                  const dedupeKey = `quote_benefit:booking:${savedBooking.id}:camp:${lockedCamp.id}:v:${lockedCamp.version}`;
                  const quotaCodes = (lockedCamp.packageConfig?.includedQuotas || [])
                    .map((q) => String(q.serviceCode || ''))
                    .filter(Boolean);
                  const allowedServices = lockedCamp.targetServiceIds?.length
                    ? lockedCamp.targetServiceIds
                    : quotaCodes.length
                      ? quotaCodes
                      : null;
                  const createdAcc = await accRepo.save(
                    accRepo.create({
                      bookingId: savedBooking.id,
                      hotelId: String(room.hotelId),
                      campaignId: lockedCamp.id,
                      benefitKind: lockedCamp.benefitKind,
                      sourceType: 'QUOTE_BENEFIT',
                      status: BenefitAccountStatus.APPROVED,
                      currency: 'VND',
                      grantedAmount: creditAmt,
                      redeemedAmount: 0,
                      reversedAmount: 0,
                      refundedAmount: 0,
                      availableAmount: creditAmt,
                      grantedQuota: totalQuota,
                      usedQuota: 0,
                      availableQuota: totalQuota,
                      allowedServiceIds: allowedServices,
                      customerAcceptedCredit: true,
                      expiresAt: new Date(checkOut),
                      dedupeKey,
                      approvedBy: staffUser.id,
                      approvedAt: new Date(),
                      note: `Quyền lợi gói/khuyến mãi đơn tại quầy (${lockedCamp.code})`,
                      version: 1,
                    }),
                  );
                  if (ledgerRepo && typeof ledgerRepo.save === 'function') {
                    await ledgerRepo.save(
                      ledgerRepo.create({
                        accountId: createdAcc.id,
                        bookingId: savedBooking.id,
                        hotelId: String(room.hotelId),
                        campaignId: lockedCamp.id,
                        entryType: BenefitLedgerEntryType.GRANT,
                        amountDelta: creditAmt,
                        balanceAfter: creditAmt,
                        quotaDelta: totalQuota,
                        quotaAfter: totalQuota,
                        performedBy: staffUser.id,
                        idempotencyKey: `grant:${dedupeKey}`,
                        reason: `Cấp quyền lợi gói tại quầy (${creditAmt}đ${totalQuota > 0 ? ` +${totalQuota} suất` : ''})`,
                        metadata: { includedQuotas: lockedCamp.packageConfig?.includedQuotas || [] },
                      }),
                    );
                  }
                }
              }
            }
          }
        }

        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: savedBooking.id,
            oldStatus: null,
            newStatus: BookingStatus.CONFIRMED,
            note: `[LỄ TÂN GHI NHẬN] Đơn tạo thành công tại quầy / điện thoại (${dto.bookingSource}). Nhân viên chốt: ${staffUser.fullName} (#${staffUser.id}).`,
            changedBy: staffUser.id,
          }),
        );

        return savedBooking;
      },
    );

    // Phát sự kiện realtime
    if (this.realtimeGateway) {
      this.realtimeGateway.emitBookingCreated({
        id: result.id,
        bookingCode: result.bookingCode,
        hotelId: room.hotelId,
        hotelName,
        userId: customerUserId,
        contactName: result.contactName,
        contactPhone: result.contactPhone,
        contactEmail: result.contactEmail,
        checkInAt: result.checkInAt.toISOString(),
        checkOutAt: result.checkOutAt.toISOString(),
        roomName: room.name,
        roomCount: result.requestedRoomCount,
        estimatedTotal: String(result.estimatedTotal),
        createdAt: result.createdAt.toISOString(),
      });
    }

    return {
      message: `Tạo đơn đặt phòng thành công qua kênh ${dto.bookingSource}.`,
      data: {
        bookingId: result.id,
        bookingCode: result.bookingCode,
        hotelId: result.hotelId,
        hotelName,
        roomName: room.name,
        customerName: result.contactName,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        totalGuests: result.totalGuests,
        roomCount: result.requestedRoomCount,
        estimatedTotal: result.estimatedTotal,
        status: result.status,
        bookingSource: result.bookingSource,
        handledByName: staffUser.fullName,
      },
    };
  }
}
