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
    return this.dataSource.transaction(async (manager) => {
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
      if (isWebsite && booking.status === BookingStatus.PENDING) {
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

      // 5. Lấy danh sách ID các nhân viên đang vắng mặt (có đơn nghỉ/đi muộn đã duyệt hoặc emergency block hiệu lực tại now)
      const absentStaffIds =
        await this.staffAvailabilityService.getUnavailableStaffUserIds(hotelId, now);
      const absentStaffSet = new Set(absentStaffIds.map((id) => String(id)));

      // 5b. Lấy danh sách nhân viên đang trực tiếp bận xử lý tác vụ độc quyền IN_PROGRESS tại thời điểm T (D1-03)
      const busyStaffSet = new Set<string>();
      try {
        const busyRows = await manager.query(
          `
          SELECT DISTINCT assigned_staff_id AS staffUserId
          FROM guest_work_tasks
          WHERE hotel_id = ?
            AND status = 'IN_PROGRESS'
            AND assigned_staff_id IS NOT NULL
            AND (type IN ('CHECK_IN', 'CHECK_OUT', 'COMPLAINT_HANDLE') OR priority = 'URGENT')
            AND (started_at IS NULL OR started_at >= DATE_SUB(?, INTERVAL 4 HOUR))
          `,
          [hotelId, now],
        );
        for (const r of busyRows || []) {
          if (r.staffUserId) busyStaffSet.add(String(r.staffUserId));
        }
      } catch {
        // Bỏ qua an toàn nếu bảng chưa khởi tạo trong môi trường test độc lập
      }

      // 5c. Kiểm tra quy tắc năng lực (staff_eligibility_rules) của khách sạn nếu có (D1-04)
      let requiredSkillCodes: string[] = [];
      let requireVerifiedSkills = false;
      try {
        const ruleRows = await manager.query(
          `SELECT required_skill_codes AS requiredSkillCodes, require_verified_skills AS requireVerifiedSkills
           FROM staff_eligibility_rules
           WHERE (hotel_id = ? OR hotel_id IS NULL) AND service_tier = ? AND active = 1
           ORDER BY hotel_id DESC LIMIT 1`,
          [hotelId, serviceTier],
        );
        if (ruleRows && ruleRows.length > 0) {
          requireVerifiedSkills = Boolean(ruleRows[0].requireVerifiedSkills);
          if (ruleRows[0].requiredSkillCodes) {
            const parsed =
              typeof ruleRows[0].requiredSkillCodes === 'string'
                ? JSON.parse(ruleRows[0].requiredSkillCodes)
                : ruleRows[0].requiredSkillCodes;
            if (Array.isArray(parsed)) {
              requiredSkillCodes = parsed.map((s) => String(s).toUpperCase());
            }
          }
        }
      } catch {
        // Bỏ qua nếu chưa cấu hình rule riêng
      }

      // 6. Truy vấn danh sách nhân viên ACTIVE của khách sạn
      const rawStaffList = await manager.query(
        `
        SELECT
          hs.staff_user_id AS staffUserId,
          u.full_name AS staffName,
          u.email AS staffEmail,
          hs.staff_role AS staffRole,
          u.status AS userStatus,
          hs.status AS hotelStaffStatus,
          COALESCE(MAX(ss.level), 1) AS skillLevel,
          COALESCE(
            SUBSTRING_INDEX(
              GROUP_CONCAT(ss.years_exp ORDER BY ss.level DESC, ss.years_exp DESC SEPARATOR ','),
              ',',
              1
            ),
            0
          ) AS yearsExp,
          COALESCE(GROUP_CONCAT(UPPER(ss.skill_code) SEPARATOR ','), '') AS skillCodesCsv,
          COALESCE(MAX(CASE WHEN ss.verified_by IS NOT NULL THEN 1 ELSE 0 END), 0) AS hasVerifiedRecord,
          (
            SELECT COUNT(*) 
            FROM bookings b 
            WHERE b.handled_by = hs.staff_user_id 
              AND b.status = 'COMPLETED'
          ) AS completedCount,
          (
            SELECT COUNT(*) 
            FROM bookings b 
            WHERE b.handled_by = hs.staff_user_id 
              AND b.status IN ('PENDING', 'CONFIRMED')
          ) AS activeLoad,
          (
            SELECT MAX(ba.assigned_at)
            FROM booking_assignments ba
            WHERE ba.hotel_id = hs.hotel_id
              AND ba.staff_user_id = hs.staff_user_id
          ) AS lastAssignedAt
        FROM hotel_staff hs
        INNER JOIN users u ON u.id = hs.staff_user_id AND u.deleted_at IS NULL
        LEFT JOIN staff_skills ss ON ss.user_id = hs.staff_user_id
        WHERE hs.hotel_id = ?
          AND hs.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
        GROUP BY hs.staff_user_id, u.full_name, u.email, hs.staff_role, u.status, hs.status, hs.hotel_id
        `,
        [hotelId],
      );

      const allCandidates: StaffCandidate[] = (rawStaffList || []).map(
        (row: any) => {
          const staffSkillCodes = String(row.skillCodesCsv || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const matchesRequiredCodes =
            requiredSkillCodes.length === 0 ||
            requiredSkillCodes.every((reqCode) => staffSkillCodes.includes(reqCode));
          const matchesVerified =
            !requireVerifiedSkills || Number(row.hasVerifiedRecord) > 0;

          return {
            staffUserId: String(row.staffUserId),
            staffName: row.staffName || `Staff ${row.staffUserId}`,
            staffEmail: row.staffEmail || '',
            staffRole: row.staffRole,
            userActive: row.userStatus === 'ACTIVE',
            hotelStaffActive: row.hotelStaffStatus === 'ACTIVE',
            isAbsent: absentStaffSet.has(String(row.staffUserId)),
            isBusyNow: busyStaffSet.has(String(row.staffUserId)),
            hasVerifiedSkill: matchesRequiredCodes && matchesVerified,
            skillLevel: Number(row.skillLevel) || 1,
            yearsExp: Number(row.yearsExp) || 0,
            completedCount: Number(row.completedCount) || 0,
            activeLoad: Number(row.activeLoad) || 0,
            lastAssignedAt: row.lastAssignedAt ? new Date(row.lastAssignedAt) : null,
          };
        },
      );

      const receptionists = allCandidates.filter(
        (c) => c.staffRole !== 'MANAGER',
      );
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
