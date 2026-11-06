import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface StaffDutySnapshot {
  hotelId: string;
  userId: string;
  at: Date;
  accountActive: boolean;
  membershipActive: boolean;
  staffRole: string | null;
  shiftId: string | null;
  shiftActive: boolean;
  withinPlannedWindow: boolean;
  absenceBlockId: string | null;
  eligible: boolean;
  reasons: string[];
}

export class StaffDutyPolicy {
  static async getDutySnapshot(
    em: EntityManager,
    hotelId: string,
    userId: string,
    at: Date = new Date(),
  ): Promise<StaffDutySnapshot> {
    const reasons: string[] = [];
    const [user] = await em.query(
      `SELECT id, role FROM users WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    const accountActive = Boolean(user);
    if (!accountActive) reasons.push('ACCOUNT_INACTIVE');

    const [staff] = await em.query(
      `SELECT id, staff_role AS staffRole FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [hotelId, userId],
    );
    const membershipActive = Boolean(staff);
    if (!membershipActive) reasons.push('NOT_HOTEL_MEMBER');

    const [block] = await em.query(
      `SELECT id FROM staff_availability_blocks WHERE hotel_id = ? AND staff_user_id = ? AND active = 1 AND start_at <= ? AND end_at > ? LIMIT 1`,
      [hotelId, userId, at, at],
    );
    const absenceBlockId = block?.id ? String(block.id) : null;
    if (absenceBlockId) reasons.push('STAFF_ABSENT');

    const [shift] = await em.query(
      `SELECT id, status, planned_start_at AS plannedStartAt, planned_end_at AS plannedEndAt
       FROM staff_shifts
       WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE'
       ORDER BY id DESC LIMIT 1`,
      [hotelId, userId],
    );
    const shiftId = shift?.id ? String(shift.id) : null;
    const shiftActive = Boolean(shift && shift.status === 'ACTIVE');
    let withinPlannedWindow = true;
    if (shift?.plannedStartAt && shift?.plannedEndAt) {
      const startMs = new Date(shift.plannedStartAt).getTime() - 30 * 60000;
      const endMs = new Date(shift.plannedEndAt).getTime() + 60 * 60000;
      withinPlannedWindow = at.getTime() >= startMs && at.getTime() <= endMs;
      if (!withinPlannedWindow) reasons.push('OUTSIDE_PLANNED_SHIFT_WINDOW');
    }

    const eligible = accountActive && membershipActive && !absenceBlockId && withinPlannedWindow;
    return {
      hotelId: String(hotelId),
      userId: String(userId),
      at,
      accountActive,
      membershipActive,
      staffRole: staff?.staffRole || null,
      shiftId,
      shiftActive,
      withinPlannedWindow,
      absenceBlockId,
      eligible,
      reasons,
    };
  }

  static async assertOnDuty(
    em: EntityManager,
    hotelId: string,
    userId: string,
    at: Date = new Date(),
    requireActiveShift = false,
  ): Promise<StaffDutySnapshot> {
    const snap = await this.getDutySnapshot(em, hotelId, userId, at);
    if (!snap.accountActive) {
      throw new ForbiddenException('ACCOUNT_INACTIVE: Tài khoản nhân sự không còn hoạt động.');
    }
    if (!snap.membershipActive) {
      throw new ForbiddenException('NOT_HOTEL_MEMBER: Nhân sự không thuộc khách sạn.');
    }
    if (snap.absenceBlockId) {
      throw new ConflictException('STAFF_ABSENT: Nhân sự đang trong khoảng nghỉ phép/vắng mặt đã duyệt.');
    }
    if (requireActiveShift && !snap.shiftActive) {
      throw new ForbiddenException('STAFF_OFF_DUTY: Nhân sự chưa mở ca trực ACTIVE.');
    }
    if (!snap.withinPlannedWindow) {
      throw new ForbiddenException('OUTSIDE_PLANNED_SHIFT_WINDOW: Thời điểm thao tác nằm ngoài khung giờ ca trực.');
    }
    return snap;
  }
}
