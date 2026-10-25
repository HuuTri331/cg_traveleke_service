import {
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
import { Booking } from '../bookings/entities/booking.entity';
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

      const hotelId = String(booking.hotelId);

      // 2. Kiểm tra Idempotency: Nếu booking đã có phân công chính đang ACTIVE -> Trả về kết quả ngay
      const existingState = await stateRepo.findOne({
        where: { bookingId },
      });

      if (
        existingState &&
        existingState.status === AssignmentStateStatus.ASSIGNED &&
        existingState.currentStaffId
      ) {
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

      // 4. Xác định hạng phòng (serviceTier) của booking
      let serviceTier = RoomServiceTier.STANDARD;
      const bookingRoom = await manager
        .getRepository(BookingRoom)
        .findOne({
          where: { bookingId },
        });

      if (bookingRoom?.roomId) {
        const room = await manager.getRepository(Room).findOne({
          where: { id: bookingRoom.roomId },
        });

        if (room?.serviceTier) {
          serviceTier = room.serviceTier;
        } else if (room) {
          // Heuristic fallback nếu dữ liệu cũ chưa có tier
          if (
            Number(room.pricePerNight) >= 1500000 ||
            /vip|suite|presidential|luxury/i.test(room.name)
          ) {
            serviceTier = RoomServiceTier.VIP;
          }
        }
      }

      // 5. Lấy danh sách ID các nhân viên đang vắng mặt (có đơn nghỉ/đi muộn đã duyệt hiệu lực tại now)
      const absentStaffIds =
        await this.staffAvailabilityService.getUnavailableStaffUserIds(hotelId, now);
      const absentStaffSet = new Set(absentStaffIds.map((id) => String(id)));

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
          COALESCE(MAX(ss.years_exp), 0) AS yearsExp,
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
        (row: any) => ({
          staffUserId: String(row.staffUserId),
          staffName: row.staffName || `Staff ${row.staffUserId}`,
          staffEmail: row.staffEmail || '',
          staffRole: row.staffRole,
          userActive: row.userStatus === 'ACTIVE',
          hotelStaffActive: row.hotelStaffStatus === 'ACTIVE',
          isAbsent: absentStaffSet.has(String(row.staffUserId)),
          skillLevel: Number(row.skillLevel) || 1,
          yearsExp: Number(row.yearsExp) || 0,
          completedCount: Number(row.completedCount) || 0,
          activeLoad: Number(row.activeLoad) || 0,
          lastAssignedAt: row.lastAssignedAt ? new Date(row.lastAssignedAt) : null,
        }),
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

        // Mirror sang bookings.handled_by để giữ tương thích 100% với các màn hình cũ
        booking.handledBy = assignedStaffId;
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
   * Lấy lịch sử phân công của một booking
   */
  async getAssignmentHistory(bookingId: string): Promise<any[]> {
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

    return qb.getRawMany();
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
}
