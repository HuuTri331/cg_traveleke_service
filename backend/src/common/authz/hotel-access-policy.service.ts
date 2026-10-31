import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { BookingCoverageService } from '../../booking-coverage/booking-coverage.service';

@Injectable()
export class HotelAccessPolicyService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly coverageService?: BookingCoverageService,
  ) {}

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

  async canManageHotel(user: { id: string; role: string }, hotelId: string): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    if (user.role !== 'EMPLOYEE') return false;

    const [staff] = await this.dataSource.query(
      'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = "MANAGER" AND status = "ACTIVE" LIMIT 1',
      [user.id, hotelId],
    );
    return Boolean(staff);
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

    // 1. Nếu là người phụ trách chính hiện tại
    if (String(booking.handledBy) === String(user.id)) return true;

    // 2. Nếu là Quản lý khách sạn
    if (await this.canManageHotel(user, booking.hotelId)) return true;

    // 3. Nếu có quyền hỗ trợ thay tạm thời (Coverage grant)
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
    if (user.role === 'ADMIN') return true;
    if (String(user.id) === String(staffId)) return true;
    return await this.canManageHotel(user, hotelId);
  }
}

