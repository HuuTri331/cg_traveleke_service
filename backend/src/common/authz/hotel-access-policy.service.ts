import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { assertBookingOperator, BookingOperatorAuthorization } from '../../bookings/services/booking-operation-policy';
import { BookingCoverageService } from '../../booking-coverage/booking-coverage.service';
import { HotelScopeResolver } from './hotel-scope-resolver.service';

@Injectable()
export class HotelAccessPolicyService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly coverageService?: BookingCoverageService,
    @Optional()
    private readonly scopeResolver?: HotelScopeResolver,
  ) {}

  private getExecutor(em?: EntityManager | any) {
    if (em && typeof em.query === 'function') return em;
    return this.dataSource;
  }

  async canViewBooking(user: { id: string; role: string }, booking: Booking): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    if (user.role === 'CUSTOMER') {
      return String(booking.userId) === String(user.id);
    }
    if (user.role === 'EMPLOYEE') {
      const [staff] = await this.dataSource.query(
        'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
        [user.id, booking.hotelId],
      );
      return Boolean(staff);
    }
    return false;
  }

  async canManageHotel(user: { id: string; role: string }, hotelId: string, em?: EntityManager | any): Promise<boolean> {
    const exec = this.getExecutor(em);
    if (user.role === 'ADMIN') return true;
    if (user.role !== 'EMPLOYEE') return false;

    const [staff] = await exec.query(
      'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = "MANAGER" AND status = "ACTIVE" LIMIT 1',
      [user.id, hotelId],
    );
    return Boolean(staff);
  }

  async assertHotelManager(user: { id: string; role: string }, hotelId: string | number, em?: EntityManager | any): Promise<void> {
    const hid = String(hotelId);
    if (this.scopeResolver) {
      await this.scopeResolver.assertActiveHotel(hid, em);
    }
    const ok = await this.canManageHotel(user, hid, em);
    if (!ok) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn (MANAGER) đang hoạt động tại cơ sở này mới có thẩm quyền thực hiện.');
    }
  }

  async assertActiveStaffAtHotel(
    user: { id: string; role: string },
    hotelId: string | number,
    em?: EntityManager | any,
  ): Promise<{ staffRole: string }> {
    const hid = String(hotelId);
    const exec = this.getExecutor(em);
    if (this.scopeResolver) {
      await this.scopeResolver.assertActiveHotel(hid, em);
    }
    if (user.role === 'ADMIN') {
      return { staffRole: 'ADMIN' };
    }
    if (user.role !== 'EMPLOYEE') {
      throw new ForbiddenException('Bạn không thuộc biên chế nhân sự khách sạn.');
    }
    const [staff] = await exec.query(
      `SELECT hs.staff_role AS staffRole
       FROM hotel_staff hs
       INNER JOIN users u ON u.id = hs.staff_user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE hs.staff_user_id = ? AND hs.hotel_id = ? AND hs.status = 'ACTIVE' LIMIT 1`,
      [user.id, hid],
    );
    if (!staff) {
      throw new ForbiddenException('Bạn không thuộc nhân sự đang hoạt động (ACTIVE) tại khách sạn này.');
    }
    return { staffRole: String(staff.staffRole) };
  }

  async assertBookingTaskAccess(
    user: { id: string; role: string },
    booking: Booking,
    taskType?: string,
    em?: EntityManager | any,
    now: Date = new Date(),
  ): Promise<BookingOperatorAuthorization> {
    const exec = em && typeof em.query === 'function' ? em : this.dataSource.manager;
    return await assertBookingOperator(exec, booking, user, taskType, now);
  }

  async canTransferOwner(user: { id: string; role: string }, booking: Booking): Promise<boolean> {
    return await this.canManageHotel(user, booking.hotelId);
  }

  async canExecuteTask(
    user: { id: string; role: string },
    booking: Booking,
    taskType: string,
    at: Date = new Date(),
  ): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    if (user.role !== 'EMPLOYEE') return false;

    if (String(booking.handledBy) === String(user.id)) return true;
    if (await this.canManageHotel(user, booking.hotelId)) return true;

    if (this.coverageService) {
      const hasCoverage = await this.coverageService.isStaffCoveringTask(booking.id, user.id, taskType, at);
      if (hasCoverage) return true;
    }

    return false;
  }

  async canReadKpi(
    user: { id: string; role: string },
    staffId: string,
    hotelId: string,
  ): Promise<boolean> {
    const [targetMembership] = await this.dataSource.query(
      'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
      [staffId, hotelId],
    );
    if (!targetMembership) return false;
    if (user.role === 'ADMIN') return true;
    if (String(user.id) === String(staffId)) {
      return true;
    }
    return await this.canManageHotel(user, hotelId);
  }

  async assertCanReadKpi(
    user: { id: string; role: string },
    staffId: string,
    hotelId: string,
  ): Promise<void> {
    const ok = await this.canReadKpi(user, staffId, hotelId);
    if (!ok) {
      throw new ForbiddenException('Bạn không có quyền truy cập KPI hoặc nhân sự không thuộc khách sạn này.');
    }
  }
}


