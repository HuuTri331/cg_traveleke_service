import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { User } from '../../users/entities/user.entity';
import { HotelStaff } from '../../hotel-staff/entities/hotel-staff.entity';

@Injectable()
export class BookingAccessService {
  constructor(
    @InjectRepository(HotelStaff)
    private readonly hotelStaffRepo: Repository<HotelStaff>,
  ) {}

  /**
   * Kiểm tra quyền xem chi tiết booking:
   * - ADMIN: được xem tất cả
   * - CUSTOMER: chỉ được xem booking do chính mình đặt (booking.userId === user.id)
   * - EMPLOYEE: phải có bản ghi ACTIVE trong hotel_staff thuộc đúng khách sạn của booking
   */
  async canView(booking: { userId: string; hotelId: string }, user: User): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;

    const currentUserId = String(user.id);
    const bookingUserId = String(booking.userId);

    if (user.role === 'CUSTOMER') {
      return bookingUserId === currentUserId;
    }

    if (user.role === 'EMPLOYEE') {
      // Check if employee is active staff at the booking's hotel
      return await this.isEmployeeAtHotel(currentUserId, String(booking.hotelId));
    }

    return false;
  }

  async assertCanView(
    booking: { userId: string; hotelId: string },
    user: User,
  ): Promise<void> {
    const allowed = await this.canView(booking, user);
    if (!allowed) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập thông tin đơn đặt phòng này.',
      );
    }
  }

  /**
   * Kiểm tra quyền quản lý / cập nhật booking (Admin hoặc Nhân viên khách sạn đó)
   */
  async canManage(booking: { hotelId: string }, user: User): Promise<boolean> {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;

    if (user.role === 'EMPLOYEE') {
      return await this.isEmployeeAtHotel(String(user.id), String(booking.hotelId));
    }

    return false;
  }

  async assertCanManage(
    booking: { hotelId: string },
    user: User,
  ): Promise<void> {
    const allowed = await this.canManage(booking, user);
    if (!allowed) {
      throw new ForbiddenException(
        'Bạn không có quyền thao tác quản lý đơn đặt phòng tại khách sạn này.',
      );
    }
  }

  /**
   * Kiểm tra nhân viên có đang công tác (ACTIVE) tại khách sạn cụ thể hay không
   */
  async isEmployeeAtHotel(staffUserId: string, hotelId: string): Promise<boolean> {
    const staff = await this.hotelStaffRepo.findOne({
      where: {
        staffUserId,
        hotelId,
        status: 'ACTIVE',
      },
    });
    return !!staff;
  }
}
