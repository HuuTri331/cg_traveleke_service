import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { coverageAllows, findCoverage } from '../../booking-coverage/coverage-policy';
import { Booking } from '../entities/booking.entity';
import { BookingHold, BookingHoldStatus } from '../../inventory/entities/booking-hold.entity';
import { BookingRoom } from '../entities/booking-room.entity';
import { PaymentTransaction, PaymentTransactionStatus } from '../../payments/entities/payment-transaction.entity';

export { coverageAllows };

export interface BookingOperatorAuthorization {
  mode: 'ADMIN' | 'CUSTOMER' | 'MANAGER' | 'PRIMARY_HANDLER' | 'COVERAGE_GRANT' | 'ASSIGNED_TASK';
  hotelId: string;
  coverageGrantId: string | null;
}

/** Caller holds the booking write lock. Read failures must abort the command. */
export async function assertCommittedEntitlement(em: EntityManager, booking: Booking): Promise<void> {
  const hold = await em.getRepository(BookingHold).findOne({ where: { bookingId: booking.id } });
  const rooms = await em.getRepository(BookingRoom).find({ where: { bookingId: booking.id } });
  // Current schema has one hold per booking: mixed-room legacy data requires explicit repair.
  const quantity = rooms.reduce((sum, r) => sum + Number(r.quantity), 0);
  if (!hold || hold.status !== BookingHoldStatus.COMMITTED || !rooms.length ||
      rooms.some((r) => String(r.roomId) !== String(hold.roomId)) ||
      Number(hold.quantity) !== quantity || quantity !== Number(booking.requestedRoomCount) ||
      new Date(hold.checkInAt).getTime() !== new Date(booking.checkInAt).getTime() ||
      new Date(hold.checkOutAt).getTime() !== new Date(booking.checkOutAt).getTime()) {
    throw new ConflictException('Booking chưa có quyền phòng COMMITTED khớp số lượng và kỳ lưu trú. Cần đối soát.');
  }
  if (!booking.bookingSource || booking.bookingSource === 'WEBSITE') {
    const paid = await em.getRepository(PaymentTransaction).findOne({
      where: { bookingId: booking.id, status: PaymentTransactionStatus.PAID },
    });
    if (!paid) throw new ConflictException('Booking website chưa xác nhận thanh toán PAID.');
  } else if (!['WALK_IN', 'PHONE'].includes(booking.bookingSource) || !booking.createdByStaffId) {
    throw new ConflictException('Thiếu chứng từ tạo booking tại quầy hợp lệ.');
  }
}

/** Same hotel is necessary, not sufficient. No catch/fallback grants access. */
export async function assertBookingOperator(
  em: EntityManager, booking: Booking, actor: { id: string; role: string },
  taskType?: string, now = new Date(),
): Promise<BookingOperatorAuthorization> {
  const [user] = await em.query(`SELECT id FROM users WHERE id = ? AND status = 'ACTIVE'
    AND deleted_at IS NULL AND role = ?`, [actor.id, actor.role]);
  if (!user) throw new ForbiddenException('Tài khoản không còn hoạt động.');
  const hotelId = String(booking.hotelId);
  if (actor.role === 'ADMIN') {
    return { mode: 'ADMIN', hotelId, coverageGrantId: null };
  }
  if (actor.role === 'CUSTOMER') {
    if (!taskType && String(booking.userId) === String(actor.id)) {
      return { mode: 'CUSTOMER', hotelId, coverageGrantId: null };
    }
    throw new ForbiddenException('Không có quyền thao tác booking.');
  }
  if (actor.role !== 'EMPLOYEE') throw new ForbiddenException('Không có quyền thao tác booking.');
  const [staff] = await em.query(`SELECT id, staff_role AS staffRole FROM hotel_staff
    WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE'`, [booking.hotelId, actor.id]);
  if (!staff) throw new ForbiddenException('Nhân sự không thuộc khách sạn.');
  if (staff.staffRole === 'MANAGER') {
    return { mode: 'MANAGER', hotelId, coverageGrantId: null };
  }
  if (String(booking.handledBy) === String(actor.id)) {
    return { mode: 'PRIMARY_HANDLER', hotelId, coverageGrantId: null };
  }
  if (taskType) {
    const covGrant = await findCoverage(em, booking.id, actor.id, taskType, now);
    if (covGrant) {
      return { mode: 'COVERAGE_GRANT', hotelId, coverageGrantId: String(covGrant.id) };
    }
  }
  if (!taskType) {
    const [grant] = await em.query(`SELECT id FROM booking_coverage_grants WHERE booking_id = ?
      AND delegate_staff_id = ? AND status = 'ACTIVE' AND start_at <= ? AND end_at > ? LIMIT 1`,
      [booking.id, actor.id, now, now]);
    if (grant) {
      return { mode: 'COVERAGE_GRANT', hotelId, coverageGrantId: grant.id ? String(grant.id) : null };
    }
    const [task] = await em.query(`SELECT id, coverage_grant_id AS coverageGrantId FROM guest_work_tasks WHERE booking_id = ?
      AND ((assigned_staff_id = ? AND status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')) OR
           (active_executor_id = ? AND status IN ('ACCEPTED','IN_PROGRESS') AND
            (execution_lease_until IS NULL OR execution_lease_until > ?))) LIMIT 1`,
      [booking.id, actor.id, actor.id, now]);
    if (task) {
      return {
        mode: 'ASSIGNED_TASK',
        hotelId,
        coverageGrantId: task.coverageGrantId ? String(task.coverageGrantId) : null,
      };
    }
  }
  throw new ForbiddenException('Cần là người phụ trách, quản lý hoặc có ủy quyền đúng phạm vi.');
}

