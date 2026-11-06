import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BookingAssignment,
  AssignmentType,
  FreshnessBucket,
} from './entities/booking-assignment.entity';
import {
  BookingAssignmentState,
  AssignmentStateStatus,
} from './entities/booking-assignment-state.entity';
import { HotelAssignmentDispatchLock } from './entities/hotel-assignment-dispatch-lock.entity';
import { BookingAssignmentCommandReceipt } from './entities/booking-assignment-command-receipt.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { User } from '../users/entities/user.entity';
import { Room, RoomServiceTier } from '../rooms/entities/room.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { loadAssignmentCandidates } from './candidate-loader';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  DecisionContext,
  pickReceptionist,
  StaffCandidate,
} from './assignment-policy';

@Injectable()
export class BookingAssignmentService {
  private readonly logger = new Logger(BookingAssignmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    @InjectRepository(BookingAssignment)
    private readonly assignmentRepo: Repository<BookingAssignment>,
    @InjectRepository(BookingAssignmentState)
    private readonly assignmentStateRepo: Repository<BookingAssignmentState>,
    @InjectRepository(HotelAssignmentDispatchLock)
    private readonly dispatchLockRepo: Repository<HotelAssignmentDispatchLock>,
    @InjectRepository(BookingAssignmentCommandReceipt)
    private readonly commandReceiptRepo: Repository<BookingAssignmentCommandReceipt>,
  ) {}

  /**
   * Phân công lễ tân cho một đơn đặt phòng đã thanh toán thành công (Idempotent Transaction).
   * Sử dụng lock hàng dispatch lock cấp khách sạn để chống race condition.
   */
  async assignOnce(
    bookingId: string,
    trigger: 'PAYMENT_PAID' | 'REPAIR' = 'PAYMENT_PAID',
  ): Promise<{
    success: boolean;
    outcome: string;
    staffUserId: string | null;
    reason: string;
    isIdempotentRepeat?: boolean;
  }> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const stateRepo = manager.getRepository(BookingAssignmentState);
      const assignmentRepo = manager.getRepository(BookingAssignment);
      const receiptRepo = manager.getRepository(BookingAssignmentCommandReceipt);

      // 1. Lock hàng booking FOR UPDATE
      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!booking) {
        throw new NotFoundException(`Không tìm thấy booking #${bookingId}`);
      }

      // Kiểm tra trạng thái đơn: Từ chối phân công nếu đơn bị hủy, từ chối hoặc hết kỳ
      if (
        booking.status === BookingStatus.CANCELLED ||
        booking.status === BookingStatus.REJECTED ||
        booking.status === BookingStatus.PAYMENT_EXPIRED ||
        booking.status === BookingStatus.CLOSED_NO_SHOW ||
        booking.status === BookingStatus.COMPLETED
      ) {
        return {
          success: false,
          outcome: 'NOT_ELIGIBLE_STATUS',
          staffUserId: null,
          reason: `Booking ở trạng thái ${booking.status}, không đủ điều kiện phân công nhân sự.`,
        };
      }

      // Với đơn website, kiểm tra đã có giao dịch PAID và hold COMMITTED
      const isWebsite = !booking.bookingSource || booking.bookingSource === 'WEBSITE';
      if (isWebsite) {
        const hasPaidTx = await manager.query(
          `SELECT id FROM payment_transactions WHERE booking_id = ? AND status = 'PAID' LIMIT 1`,
          [bookingId],
        );
        const hasCommittedHold = await manager.query(
          `SELECT id FROM booking_holds WHERE booking_id = ? AND status = 'COMMITTED' LIMIT 1`,
          [bookingId],
        );

        if (!hasPaidTx || hasPaidTx.length === 0 || !hasCommittedHold || hasCommittedHold.length === 0) {
          return {
            success: false,
            outcome: 'NOT_ELIGIBLE_UNPAID',
            staffUserId: null,
            reason: 'Booking chưa đủ xác nhận thanh toán (PAID) và giữ phòng (COMMITTED).',
          };
        }
      }

      const hotelId = String(booking.hotelId);

      // 2. Kiểm tra Idempotency & Legacy Import:
      let existingState = await stateRepo.findOne({
        where: { bookingId },
      });

      if (
        existingState &&
        existingState.status === AssignmentStateStatus.ASSIGNED &&
        existingState.currentStaffId
      ) {
        if (booking.handledBy && String(booking.handledBy) !== String(existingState.currentStaffId)) {
          this.logger.warn(
            `[BookingAssignment] Phát hiện lệch owner: booking.handledBy (#${booking.handledBy}) khác state (#${existingState.currentStaffId}) tại booking #${bookingId}`,
          );
        }

        // P1-17: Rà soát sức khỏe người phụ trách đã gán (tài khoản/biên chế bị khóa hoặc đang nghỉ không có B thay)
        if (typeof manager.query === 'function') {
          const [ownerHealth] = await manager.query(
            `SELECT
               EXISTS(
                 SELECT 1 FROM hotel_staff hs
                 JOIN users u ON u.id = hs.staff_user_id
                 WHERE hs.hotel_id = ? AND hs.staff_user_id = ?
                   AND hs.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
               ) AS membershipActive,
               EXISTS(
                 SELECT 1 FROM staff_availability_blocks b
                 WHERE b.hotel_id = ? AND b.staff_user_id = ?
                   AND b.active = 1 AND b.start_at <= NOW() AND b.end_at > NOW()
               ) AS isAbsentNow,
               EXISTS(
                 SELECT 1 FROM booking_coverage_grants g
                 WHERE g.booking_id = ? AND g.status = 'ACTIVE'
                   AND g.start_at <= NOW() AND g.end_at > NOW()
               ) AS hasActiveCoverage`,
            [
              hotelId,
              existingState.currentStaffId,
              hotelId,
              existingState.currentStaffId,
              bookingId,
            ],
          );
          if (
            ownerHealth &&
            ownerHealth.membershipActive !== undefined &&
            (!Number(ownerHealth.membershipActive) ||
              (Number(ownerHealth.isAbsentNow) && !Number(ownerHealth.hasActiveCoverage)))
          ) {
            const incidentKind = !Number(ownerHealth.membershipActive)
              ? 'OWNER_INACTIVE_CRITICAL'
              : 'COVERAGE_GAP_CRITICAL';
            await manager.query(
              `INSERT INTO booking_assignment_incidents
               (booking_id, hotel_id, kind, severity, status, opened_at, due_at, current_owner_id, last_error, command_key)
               SELECT ?, ?, ?, 'CRITICAL', 'OPEN', NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE), ?, ?, ?
               FROM DUAL
               WHERE NOT EXISTS (
                 SELECT 1 FROM booking_assignment_incidents
                 WHERE booking_id = ? AND kind = ? AND status = 'OPEN'
               )`,
              [
                bookingId,
                hotelId,
                incidentKind,
                existingState.currentStaffId,
                `Người phụ trách #${existingState.currentStaffId} không còn khả dụng (${incidentKind}) và chưa có B thay thế.`,
                `health:${bookingId}:${incidentKind}`,
                bookingId,
                incidentKind,
              ],
            );
          }
        }

        this.logger.log(
          `[BookingAssignment] Booking #${bookingId} đã được phân công cho nhân viên ${existingState.currentStaffId} trước đó (Idempotent No-op).`,
        );
        return {
          success: true,
          outcome: 'ALREADY_ASSIGNED',
          staffUserId: existingState.currentStaffId,
          reason: 'Booking đã được phân công thành công trước đó.',
          isIdempotentRepeat: true,
        };
      }

      // Nếu booking legacy đã có handledBy từ trước nhưng chưa có state -> Import bảo toàn
      if (!existingState && booking.handledBy) {
        this.logger.log(
          `[BookingAssignment] Backfill legacy owner #${booking.handledBy} cho booking #${bookingId}`,
        );
        const legacyAssignment = assignmentRepo.create({
          bookingId,
          hotelId,
          staffUserId: String(booking.handledBy),
          assignmentVersion: 1,
          assignmentType: AssignmentType.LEGACY_IMPORT,
          competencyLevel: null,
          freshnessBucket: null,
          reason: booking.assignmentNote || 'Import nhân viên phụ trách từ dữ liệu trước đó',
          assignedAt: booking.reassignedAt || booking.createdAt || new Date(),
          policyVersion: '1.0',
          sourceEventId: 'LEGACY_IMPORT',
        });
        const savedLegacy = await assignmentRepo.save(legacyAssignment);

        existingState = stateRepo.create({
          bookingId,
          currentAssignmentId: savedLegacy.id,
          currentStaffId: String(booking.handledBy),
          status: AssignmentStateStatus.ASSIGNED,
          version: 1,
        });
        await stateRepo.save(existingState);

        return {
          success: true,
          outcome: 'LEGACY_IMPORTED',
          staffUserId: String(booking.handledBy),
          reason: 'Đã bảo toàn nhân viên phụ trách hiện hữu từ hệ thống cũ.',
          isIdempotentRepeat: true,
        };
      }

      // 3. Khóa hàng khách sạn (Hotel Dispatch Lock) FOR UPDATE để tuần tự hóa các phân công cùng hotel
      await manager.query(
        `INSERT IGNORE INTO hotel_assignment_dispatch_locks (hotel_id, version, updated_at) VALUES (?, 0, NOW())`,
        [hotelId],
      );
      await manager.query(
        `SELECT hotel_id FROM hotel_assignment_dispatch_locks WHERE hotel_id = ? FOR UPDATE`,
        [hotelId],
      );

      const now = new Date();

      // 4. Xác định hạng phòng (serviceTier) của TOÀN BỘ booking (D1-06: xét tất cả phòng trong booking, lấy mức độ khó cao nhất VIP > STANDARD > ECONOMY)
      let serviceTier = RoomServiceTier.STANDARD;
      const bookingRooms = await manager
        .getRepository(BookingRoom)
        .find({
          where: { bookingId },
        });

      if (bookingRooms && bookingRooms.length > 0) {
        let hasVip = false;
        let hasStandard = false;
        let hasEconomy = false;

        for (const br of bookingRooms) {
          if (!br.roomId) continue;
          const room = await manager.getRepository(Room).findOne({
            where: { id: br.roomId },
          });
          if (!room) continue;

          const roomIsVip =
            room.serviceTier === RoomServiceTier.VIP ||
            (!room.serviceTier &&
              (Number(room.pricePerNight) >= 1500000 ||
                /vip|suite|presidential|luxury/i.test(room.name)));

          if (roomIsVip) {
            hasVip = true;
          } else if (room.serviceTier === RoomServiceTier.ECONOMY) {
            hasEconomy = true;
          } else {
            hasStandard = true;
          }
        }

        if (hasVip) {
          serviceTier = RoomServiceTier.VIP;
        } else if (hasStandard) {
          serviceTier = RoomServiceTier.STANDARD;
        } else if (hasEconomy) {
          serviceTier = RoomServiceTier.ECONOMY;
        }
      }

      // Required data failures propagate to the durable outbox retry; never assume staff are free.
      const allCandidates = await loadAssignmentCandidates(manager, hotelId, serviceTier, now);
      const receptionists = allCandidates.filter((c) => c.staffRole !== 'MANAGER');
      const managers = allCandidates.filter((c) => c.staffRole === 'MANAGER');

      // 7. Chạy thuật toán quyết định phân công công bằng (assignment-policy)
      const context: DecisionContext = {
        bookingId,
        hotelId,
        serviceTier,
        now,
        candidates: receptionists,
        managers,
      };

      const decision = pickReceptionist(context);

      // 8. Lấy version kế tiếp của booking
      const lastAssignment = await assignmentRepo.findOne({
        where: { bookingId },
        order: { assignmentVersion: 'DESC' },
      });
      const nextVersion = (lastAssignment?.assignmentVersion || 0) + 1;

      let savedAssignment: BookingAssignment | null = null;

      if (decision.chosenCandidate) {
        const assignedStaffId = decision.chosenCandidate.staffUserId;

        // Lưu bản ghi lịch sử phân công mới
        savedAssignment = assignmentRepo.create({
          bookingId,
          hotelId,
          staffUserId: assignedStaffId,
          assignmentVersion: nextVersion,
          assignmentType:
            decision.outcome === 'MANAGER_FALLBACK'
              ? AssignmentType.MANAGER_FALLBACK
              : AssignmentType.AUTO,
          competencyLevel: decision.competencyLevel,
          freshnessBucket: decision.freshnessBucket,
          reason: decision.reason,
          assignedAt: now,
          policyVersion: '1.0',
          sourceEventId: trigger,
        });
        await assignmentRepo.save(savedAssignment);

        // Cập nhật / Upsert trạng thái phân công chính
        let state = existingState;
        if (!state) {
          state = stateRepo.create({
            bookingId,
            currentAssignmentId: savedAssignment.id,
            currentStaffId: assignedStaffId,
            status: AssignmentStateStatus.ASSIGNED,
            version: 1,
          });
        } else {
          state.currentAssignmentId = savedAssignment.id;
          state.currentStaffId = assignedStaffId;
          state.status = AssignmentStateStatus.ASSIGNED;
          state.version += 1;
        }
        await stateRepo.save(state);

        // Mirror sang bookings để giữ tương thích 100% với các màn hình cũ
        booking.handledBy = assignedStaffId;
        booking.assignmentType =
          decision.outcome === 'MANAGER_FALLBACK' ? 'MANAGER_FALLBACK' : 'AUTO';
        booking.assignmentNote = decision.reason;
        await bookingRepo.save(booking);

        // Ghi command receipt thành công
        await receiptRepo.save(
          receiptRepo.create({
            bookingId,
            commandKey: trigger,
            status: 'SUCCESS',
            attempts: 1,
            lastError: null,
          }),
        );

        if (typeof manager.query === 'function') {
          await manager.query(
            `UPDATE booking_assignment_incidents
             SET status = 'RESOLVED', resolved_at = ?, current_owner_id = ?
             WHERE booking_id = ? AND status = 'OPEN'`,
            [now, assignedStaffId, bookingId],
          );
        }

        this.logger.log(
          `[BookingAssignment] Đã phân công thành công booking #${bookingId} cho ${decision.chosenCandidate.staffName} (${assignedStaffId}) [Tier: ${serviceTier}, Bucket: ${decision.freshnessBucket}, Outcome: ${decision.outcome}].`,
        );

        return {
          success: true,
          outcome: decision.outcome,
          staffUserId: assignedStaffId,
          reason: decision.reason,
        };
      }

      // Nhánh UNASSIGNED_CRITICAL (không có ai khả dụng)
      savedAssignment = assignmentRepo.create({
        bookingId,
        hotelId,
        staffUserId: null,
        assignmentVersion: nextVersion,
        assignmentType: AssignmentType.AUTO,
        competencyLevel: null,
        freshnessBucket: null,
        reason: decision.reason,
        assignedAt: now,
        policyVersion: '1.0',
        sourceEventId: trigger,
      });
      await assignmentRepo.save(savedAssignment);

      let state = existingState;
      if (!state) {
        state = stateRepo.create({
          bookingId,
          currentAssignmentId: savedAssignment.id,
          currentStaffId: null,
          status: AssignmentStateStatus.UNASSIGNED_CRITICAL,
          version: 1,
        });
      } else {
        state.currentAssignmentId = savedAssignment.id;
        state.currentStaffId = null;
        state.status = AssignmentStateStatus.UNASSIGNED_CRITICAL;
        state.version += 1;
      }
      await stateRepo.save(state);

      // Ghi command receipt cảnh báo
      await receiptRepo.save(
        receiptRepo.create({
          bookingId,
          commandKey: trigger,
          status: 'UNASSIGNED_CRITICAL',
          attempts: 1,
          lastError: decision.reason,
        }),
      );

      // P2-03: Ghi nhận sự cố UNASSIGNED_CRITICAL có SLA deadline 15 phút cho hàng đợi Quản lý
      if (typeof manager.query === 'function') {
        const slaDueAt = new Date(now.getTime() + 15 * 60000);
        await manager.query(
          `INSERT INTO booking_assignment_incidents
           (booking_id, hotel_id, kind, severity, status, opened_at, due_at, current_owner_id, retry_count, last_error, command_key)
           SELECT ?, ?, 'UNASSIGNED_CRITICAL', 'CRITICAL', 'OPEN', ?, ?, NULL, 1, ?, ?
           FROM DUAL
           WHERE NOT EXISTS (
             SELECT 1 FROM booking_assignment_incidents
             WHERE booking_id = ? AND kind = 'UNASSIGNED_CRITICAL' AND status = 'OPEN'
           )`,
          [
            bookingId,
            hotelId,
            now,
            slaDueAt,
            decision.reason,
            `unassigned:${bookingId}`,
            bookingId,
          ],
        );
      }

      this.logger.warn(
        `[BookingAssignment] Booking #${bookingId} rơi vào UNASSIGNED_CRITICAL tại hotel #${hotelId}`,
      );

      return {
        success: false,
        outcome: 'UNASSIGNED_CRITICAL',
        staffUserId: null,
        reason: decision.reason,
      };
    });
  }

  /**
   * P1-17 & P2-03: Giám sát sức khỏe người phụ trách các booking đang mở
   */
  async monitorAssignedBookingsHealth(hotelId?: string): Promise<{ checkedCount: number; incidentCount: number }> {
    if (typeof this.dataSource?.query !== 'function') {
      return { checkedCount: 0, incidentCount: 0 };
    }
    const params: any[] = [];
    const hotelClause = hotelId ? ' AND b.hotel_id = ?' : '';
    if (hotelId) params.push(hotelId);
    const rows = await this.dataSource.query(
      `SELECT b.id AS bookingId, b.hotel_id AS hotelId, b.handled_by AS handledBy
       FROM bookings b
       WHERE b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'NO_SHOW')
         AND b.handled_by IS NOT NULL${hotelClause}
       LIMIT 200`,
      params,
    );
    let incidentCount = 0;
    for (const r of rows || []) {
      const res = await this.assignOnce(String(r.bookingId), 'REPAIR');
      if (!res.success) incidentCount += 1;
    }
    return { checkedCount: Array.isArray(rows) ? rows.length : 0, incidentCount };
  }

  /**
   * Lấy lịch sử phân công của một booking (Kiểm tra quyền truy cập theo vai trò)
   */
  async getAssignmentHistory(bookingId: string, actor?: User): Promise<any[]> {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (actor) {
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException(
            'Bạn không có quyền xem thông tin phân công của đơn đặt phòng này.',
          );
        }
      } else if (actor.role === 'EMPLOYEE') {
        const isStaff = await this.isStaffAtHotel(String(actor.id), String(booking.hotelId));
        if (!isStaff) {
          throw new ForbiddenException(
            'Bạn không có quyền xem lịch sử phân công tại khách sạn này.',
          );
        }
      }
    }

    const qb = this.assignmentRepo
      .createQueryBuilder('ba')
      .leftJoin('users', 'u', 'u.id = ba.staff_user_id')
      .select([
        'ba.id AS id',
        'ba.booking_id AS bookingId',
        'ba.hotel_id AS hotelId',
        'ba.staff_user_id AS staffUserId',
        'u.full_name AS staffName',
        'u.email AS staffEmail',
        'ba.assignment_version AS assignmentVersion',
        'ba.assignment_type AS assignmentType',
        'ba.competency_level AS competencyLevel',
        'ba.freshness_bucket AS freshnessBucket',
        'ba.reason AS reason',
        'ba.assigned_at AS assignedAt',
        'ba.ended_at AS endedAt',
        'ba.policy_version AS policyVersion',
      ])
      .where('ba.booking_id = :bookingId', { bookingId })
      .orderBy('ba.assignment_version', 'ASC');

    const history = await qb.getRawMany();

    // Với CUSTOMER, bảo vệ quyền riêng tư nội bộ: không để lộ email cá nhân của nhân sự
    if (actor?.role === 'CUSTOMER') {
      return history.map((row) => ({
        ...row,
        staffEmail: null,
      }));
    }

    return history;
  }

  /**
   * Kích hoạt phân công thủ công bởi người dùng có quyền (ADMIN hoặc Quản lý khách sạn)
   */
  async triggerAssignmentForAuthorizedUser(
    bookingId: string,
    actor: User,
  ): Promise<{
    success: boolean;
    outcome: string;
    staffUserId: string | null;
    reason: string;
    isIdempotentRepeat?: boolean;
  }> {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (actor.role !== 'ADMIN') {
      const isManager = await this.isManagerAtHotel(String(actor.id), String(booking.hotelId));
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên (ADMIN) mới có quyền kích hoạt phân công lại.',
        );
      }
    }

    return this.assignOnce(bookingId, 'MANUAL_TRIGGER' as any);
  }

  /**
   * Job định kỳ quét và phân công bù cho các booking đã PAID nhưng chưa có người phụ trách
   */
  async repairUnassignedPaidBookings(): Promise<{ repairedCount: number }> {
    const unassignedBookings = await this.dataSource.query(
      `
      SELECT b.id AS bookingId
      FROM bookings b
      LEFT JOIN booking_assignment_state bas ON bas.booking_id = b.id
      JOIN payment_transactions pt ON pt.booking_id = b.id AND pt.status = 'PAID'
      JOIN booking_holds bh ON bh.booking_id = b.id AND bh.status = 'COMMITTED'
      WHERE b.status IN ('PENDING', 'CONFIRMED')
        AND (bas.booking_id IS NULL OR bas.status = 'UNASSIGNED_CRITICAL' OR bas.current_staff_id IS NULL)
      LIMIT 20
      `,
    );

    let count = 0;
    for (const row of unassignedBookings || []) {
      try {
        const res = await this.assignOnce(String(row.bookingId), 'REPAIR');
        if (res.success) count++;
      } catch (err: any) {
        this.logger.error(
          `[BookingAssignment] Lỗi repair booking #${row.bookingId}: ${err.message}`,
        );
      }
    }

    return { repairedCount: count };
  }

  async isStaffAtHotel(staffUserId: string, hotelId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [staffUserId, hotelId],
    );
    return rows && rows.length > 0;
  }

  async isManagerAtHotel(staffUserId: string, hotelId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [staffUserId, hotelId],
    );
    return rows && rows.length > 0;
  }
}
