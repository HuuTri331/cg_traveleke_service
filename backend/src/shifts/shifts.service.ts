import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { StaffShift, ShiftStatus } from './entities/staff-shift.entity';
import { ShiftHandover, HandoverStatus } from './entities/shift-handover.entity';
import {
  CreateShiftDto,
  StartShiftDto,
  EndShiftDto,
  CreateHandoverDto,
} from './dto/shifts.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(StaffShift)
    private readonly shiftRepo: Repository<StaffShift>,

    @InjectRepository(ShiftHandover)
    private readonly handoverRepo: Repository<ShiftHandover>,

    private readonly dataSource: DataSource,
  ) {}

  /**
   * Lấy danh sách ca làm việc của chính nhân viên đang đăng nhập
   */
  async getMyShifts(staffUserId: string) {
    const shifts = await this.dataSource.query(
      `
      SELECT
        s.id,
        s.hotel_id AS hotelId,
        h.name AS hotelName,
        s.shift_name AS shiftName,
        s.shift_date AS shiftDate,
        s.start_time AS startTime,
        s.end_time AS endTime,
        s.status,
        s.opening_cash_float AS openingCashFloat,
        s.closing_cash_counted AS closingCashCounted,
        s.cash_variance AS cashVariance,
        s.handover_note AS handoverNote,
        s.created_at AS createdAt
      FROM staff_shifts s
      LEFT JOIN hotels h ON h.id = s.hotel_id
      WHERE s.staff_user_id = ?
      ORDER BY s.shift_date DESC, s.created_at DESC
      `,
      [staffUserId],
    );

    return {
      success: true,
      data: shifts,
    };
  }

  /**
   * Lấy ca trực đang ACTIVE của nhân viên hiện tại
   */
  async getActiveShift(staffUserId: string) {
    const activeShift = await this.shiftRepo.findOne({
      where: { staffUserId, status: ShiftStatus.ACTIVE },
      order: { id: 'DESC' },
    });
    return {
      success: true,
      data: activeShift || null,
    };
  }

  /**
   * Lấy danh sách biên bản bàn giao ca của khách sạn (kiểm tra quyền nhân sự khách sạn)
   */
  async getHotelHandovers(hotelId: string, actor: User) {
    if (actor.role !== 'ADMIN') {
      const isStaff = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [hotelId, actor.id],
      );
      if (!isStaff || isStaff.length === 0) {
        throw new ForbiddenException('Bạn không có quyền xem danh sách bàn giao ca tại khách sạn này.');
      }
    }
    const list = await this.handoverRepo.find({
      where: { hotelId },
      order: { createdAt: 'DESC' },
    });
    return {
      success: true,
      data: list,
    };
  }

  /**
   * Lấy danh sách ca làm việc của khách sạn (Dành cho Quản lý / Supervisor)
   */
  async getHotelShifts(hotelId: string, actor: User, date?: string) {
    if (actor.role !== 'ADMIN') {
      const isStaff = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [hotelId, actor.id],
      );
      if (!isStaff || isStaff.length === 0) {
        throw new ForbiddenException(
          'Bạn không có quyền xem danh sách ca trực tại khách sạn này.',
        );
      }
    }

    let query = `
      SELECT
        s.id,
        s.hotel_id AS hotelId,
        s.staff_user_id AS staffUserId,
        u.full_name AS staffName,
        u.email AS staffEmail,
        hs.staff_role AS staffRole,
        s.shift_name AS shiftName,
        s.shift_date AS shiftDate,
        s.start_time AS startTime,
        s.end_time AS endTime,
        s.status,
        s.opening_cash_float AS openingCashFloat,
        s.closing_cash_counted AS closingCashCounted,
        s.cash_variance AS cashVariance,
        s.handover_note AS handoverNote
      FROM staff_shifts s
      INNER JOIN users u ON u.id = s.staff_user_id
      LEFT JOIN hotel_staff hs ON hs.hotel_id = s.hotel_id AND hs.staff_user_id = s.staff_user_id AND hs.status = 'ACTIVE'
      WHERE s.hotel_id = ?
    `;
    const params: any[] = [hotelId];

    if (date) {
      query += ` AND s.shift_date = ?`;
      params.push(date);
    }

    query += ` ORDER BY s.shift_date DESC, s.start_time DESC`;

    const rows = await this.dataSource.query(query, params);
    return {
      success: true,
      data: rows,
    };
  }

  /**
   * Tạo lịch ca làm việc (Chỉ Manager hoặc Admin)
   */
  async createShift(dto: CreateShiftDto, actor: User) {
    if (actor.role !== 'ADMIN') {
      const isManager = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
        [dto.hotelId, actor.id],
      );
      if (!isManager || isManager.length === 0) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền xếp ca làm việc.',
        );
      }
    }

    // Kiểm tra nhân sự có thuộc khách sạn không
    const isStaff = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [dto.hotelId, dto.staffUserId],
    );
    if (!isStaff || isStaff.length === 0) {
      throw new BadRequestException(
        'Nhân viên được xếp ca không thuộc danh sách nhân sự đang công tác tại khách sạn này.',
      );
    }

    const shift = this.shiftRepo.create({
      hotelId: dto.hotelId,
      staffUserId: dto.staffUserId,
      shiftName: dto.shiftName.trim(),
      shiftDate: dto.shiftDate,
      status: ShiftStatus.SCHEDULED,
      openingCashFloat: dto.openingCashFloat !== undefined ? String(dto.openingCashFloat) : '0.00',
    });

    const saved = await this.shiftRepo.save(shift);
    return {
      success: true,
      message: 'Xếp ca làm việc thành công.',
      data: saved,
    };
  }

  /**
   * Nhân viên mở ca làm việc (Check-in ca)
   */
  async startShift(shiftId: string, staffUserId: string, dto: StartShiftDto) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc.');
    }

    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(shift.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của ca trực.');
    }

    if (String(shift.staffUserId) !== String(staffUserId)) {
      throw new ForbiddenException('Bạn không phải là người trực của ca làm việc này.');
    }

    if (typeof this.dataSource?.query === 'function') {
      const activeMembership = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [shift.hotelId, staffUserId],
      );
      if (Array.isArray(activeMembership) && activeMembership.length === 0) {
        throw new ForbiddenException('Bạn không còn thuộc nhân sự đang hoạt động (ACTIVE) tại khách sạn của ca trực này.');
      }
    }

    if (shift.status === ShiftStatus.ACTIVE) {
      return { success: true, message: 'Ca làm việc đã được mở trước đó.', data: shift };
    }

    if (shift.status === ShiftStatus.COMPLETED || shift.status === ShiftStatus.CANCELLED) {
      throw new BadRequestException(`Ca làm việc đã ở trạng thái ${shift.status}.`);
    }

    shift.status = ShiftStatus.ACTIVE;
    shift.startTime = new Date();
    if (dto.openingCashFloat !== undefined) {
      shift.openingCashFloat = String(dto.openingCashFloat);
    }

    const updated = await this.shiftRepo.save(shift);
    return {
      success: true,
      message: 'Mở ca làm việc thành công.',
      data: updated,
    };
  }

  /**
   * Nhân viên kết thúc ca làm việc (Check-out ca & đối soát quỹ tiền mặt)
   */
  async endShift(shiftId: string, staffUserId: string, dto: EndShiftDto) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc.');
    }

    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(shift.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của ca trực.');
    }

    if (String(shift.staffUserId) !== String(staffUserId)) {
      throw new ForbiddenException('Bạn không phải là người trực của ca làm việc này.');
    }

    if (typeof this.dataSource?.query === 'function') {
      const activeMembership = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [shift.hotelId, staffUserId],
      );
      if (Array.isArray(activeMembership) && activeMembership.length === 0) {
        throw new ForbiddenException('Bạn không còn thuộc nhân sự đang hoạt động (ACTIVE) tại khách sạn của ca trực này.');
      }
    }

    if (shift.status !== ShiftStatus.ACTIVE) {
      throw new BadRequestException('Chỉ có thể kết thúc ca đang ở trạng thái ACTIVE.');
    }

    const rawCounted = dto.closingCashCounted ?? dto.closingCashActual;
    if (rawCounted === undefined || rawCounted === null || Number.isNaN(Number(rawCounted))) {
      throw new BadRequestException('Số tiền mặt kiểm đếm cuối ca là bắt buộc.');
    }
    const counted = Number(rawCounted);
    const opening = Number(shift.openingCashFloat || 0);

    // Tính tổng tiền mặt thu từ walk-in / lễ tân trong ca này
    const [cashRows] = await this.dataSource.query(
      `
      SELECT COALESCE(SUM(b.estimated_total), 0) AS totalCash
      FROM bookings b
      WHERE b.hotel_id = ?
        AND b.handled_by = ?
        AND b.booking_source IN ('WALK_IN', 'PHONE')
        AND b.status = 'CONFIRMED'
        AND b.created_at >= ?
      `,
      [shift.hotelId, staffUserId, shift.startTime || shift.createdAt],
    );

    const totalCashCollected = Number(cashRows?.totalCash || 0);
    const expectedClosing = opening + totalCashCollected;
    const variance = counted - expectedClosing;

    shift.status = ShiftStatus.COMPLETED;
    shift.endTime = new Date();
    shift.closingCashCounted = String(counted);
    shift.cashVariance = String(variance);
    if (dto.handoverNote) {
      shift.handoverNote = dto.handoverNote;
    }

    const updated = await this.shiftRepo.save(shift);
    return {
      success: true,
      message: 'Kết thúc ca làm việc thành công.',
      data: {
        ...updated,
        expectedClosing,
        cashVariance: variance,
      },
    };
  }

  /**
   * Tạo biên bản bàn giao ca
   */
  async createHandover(
    shiftId: string,
    fromStaffId: string,
    dto: CreateHandoverDto,
  ) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc để bàn giao.');
    }

    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(shift.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của ca trực.');
    }

    if (String(shift.staffUserId) !== String(fromStaffId)) {
      throw new ForbiddenException('Bạn không phải là người trực của ca này.');
    }

    // Kiểm tra nhân viên giao ca vẫn ACTIVE tại khách sạn của ca trực
    const isSenderActive = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [shift.hotelId, fromStaffId],
    );
    if (!isSenderActive || isSenderActive.length === 0) {
      throw new ForbiddenException(
        'Nhân viên bàn giao không còn thuộc biên chế đang hoạt động (ACTIVE) tại khách sạn này.',
      );
    }

    // Kiểm tra nhân viên nhận bàn giao
    const isReceiverStaff = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [shift.hotelId, dto.toStaffId],
    );

    if (!isReceiverStaff || isReceiverStaff.length === 0) {
      throw new ForbiddenException(
        'Nhân viên nhận bàn giao không thuộc biên chế đang công tác tại khách sạn này.',
      );
    }

    // PP-P1-22 & FIX-25: Tổng hợp danh sách công nợ / quyền lợi khuyến mãi đang mở tại khách sạn khi bàn giao ca A -> B
    // Fail-closed: KHÔNG bọc try/catch rỗng; lưu structured checklist items có trạng thái acknowledged, follow-up actor và SLA deadline.
    let openFinancialItems: Array<{
      accountId: string;
      bookingId: string;
      bookingCode: string;
      handledBy: string | null;
      benefitKind: string;
      availableAmount: number;
      availableQuota: number;
      customerAcceptedCredit: boolean;
      status: string;
      acknowledged: boolean;
      assignedFollowUpActor: string;
      slaDeadline: string;
    }> = [];
    if (typeof this.dataSource.query === 'function') {
      const rows = await this.dataSource.query(
        `SELECT a.id AS accountId, a.booking_id AS bookingId, b.booking_code AS bookingCode, b.handled_by AS handledBy,
                a.benefit_kind AS benefitKind, a.available_amount AS availableAmount,
                a.available_quota AS availableQuota, a.customer_accepted_credit AS customerAcceptedCredit,
                a.status AS status
         FROM booking_benefit_accounts a
         INNER JOIN bookings b ON b.id = a.booking_id
         WHERE a.hotel_id = ? AND a.status IN ('APPROVED', 'REFUND_PENDING')
           AND (a.available_amount > 0 OR a.available_quota > 0)
         ORDER BY a.id ASC`,
        [shift.hotelId],
      );
      if (Array.isArray(rows)) {
        const defaultDeadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const ackSet = new Set((dto.acknowledgedFinancialAccountIds || []).map(String));
        openFinancialItems = rows.map((r: any) => ({
          accountId: String(r.accountId || r.bookingId),
          bookingId: String(r.bookingId),
          bookingCode: String(r.bookingCode || ''),
          handledBy: r.handledBy ? String(r.handledBy) : null,
          benefitKind: String(r.benefitKind),
          availableAmount: Number(r.availableAmount || 0),
          availableQuota: Number(r.availableQuota || 0),
          customerAcceptedCredit: Boolean(r.customerAcceptedCredit),
          status: String(r.status),
          acknowledged: ackSet.has(String(r.accountId || r.bookingId)),
          assignedFollowUpActor: String(dto.toStaffId),
          slaDeadline: defaultDeadline,
        }));
      }
    }

    const financialSummaryNote =
      openFinancialItems.length > 0
        ? ` [Sổ quyền lợi mở bàn giao ca: ${openFinancialItems
            .map((i) => `${i.bookingCode}: ${i.availableAmount.toLocaleString('vi-VN')}đ (${i.status})`)
            .join('; ')}]`
        : '';

    const structuredPendingTasks =
      openFinancialItems.length > 0
        ? JSON.stringify({
            notes: dto.pendingTasks || null,
            openFinancialItems,
          })
        : dto.pendingTasks || null;

    const handover = this.handoverRepo.create({
      shiftId,
      hotelId: shift.hotelId,
      fromStaffId,
      toStaffId: dto.toStaffId,
      pendingTasks: structuredPendingTasks,
      cashAmount: dto.cashAmount !== undefined ? String(dto.cashAmount) : '0.00',
      specialNotes: `${dto.specialNotes || ''}${financialSummaryNote}`.trim() || null,
      status: HandoverStatus.PENDING,
    });

    const saved = await this.handoverRepo.save(handover);
    return {
      success: true,
      message: 'Tạo biên bản bàn giao ca thành công. Chờ ca sau xác nhận tiếp nhận.',
      data: {
        ...saved,
        openFinancialItems,
      },
    };
  }

  /**
   * Nhân viên ca sau xác nhận tiếp nhận bàn giao
   */
  async acceptHandover(handoverId: string, toStaffId: string) {
    const handover = await this.handoverRepo.findOne({ where: { id: handoverId } });
    if (!handover) {
      throw new NotFoundException('Không tìm thấy biên bản bàn giao.');
    }

    if (String(handover.toStaffId) !== String(toStaffId)) {
      throw new ForbiddenException(
        'Chỉ nhân viên được chỉ định nhận bàn giao mới có quyền ký xác nhận.',
      );
    }

    if (typeof this.dataSource?.query === 'function') {
      const isReceiverActive = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [handover.hotelId, toStaffId],
      );
      if (!isReceiverActive || isReceiverActive.length === 0) {
        throw new ForbiddenException('Bạn không còn thuộc biên chế đang hoạt động (ACTIVE) tại khách sạn của biên bản bàn giao này.');
      }
    }

    if (handover.status === HandoverStatus.ACCEPTED) {
      return { success: true, message: 'Biên bản bàn giao đã được tiếp nhận trước đó.', data: handover };
    }

    if (typeof handover.pendingTasks === 'string' && handover.pendingTasks.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(handover.pendingTasks);
        if (Array.isArray(parsed?.openFinancialItems)) {
          parsed.openFinancialItems = parsed.openFinancialItems.map((item: any) => ({
            ...item,
            acknowledged: true,
            acknowledgedBy: String(toStaffId),
            acknowledgedAt: new Date().toISOString(),
          }));
          handover.pendingTasks = JSON.stringify(parsed);
        }
      } catch {}
    }

    handover.status = HandoverStatus.ACCEPTED;
    handover.acceptedAt = new Date();

    const updated = await this.handoverRepo.save(handover);
    return {
      success: true,
      message: 'Tiếp nhận bàn giao ca thành công.',
      data: updated,
    };
  }
}
