import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { HotelStaff } from './entities/hotel-staff.entity';
import { AssignStaffDto } from './dto/assign-staff.dto';

@Injectable()
export class HotelStaffService {
  constructor(
    @InjectRepository(HotelStaff)
    private readonly hotelStaffRepository: Repository<HotelStaff>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Phân công nhân viên vào khách sạn.
   */
  async assignStaff(dto: AssignStaffDto) {
    // Kiểm tra khách sạn tồn tại
    const [hotel] = await this.dataSource.query(
      'SELECT id, name FROM hotels WHERE id = ? AND deleted_at IS NULL',
      [dto.hotelId],
    );
    if (!hotel) {
      throw new NotFoundException('Không tìm thấy khách sạn.');
    }

    // Kiểm tra nhân viên tồn tại và có role phù hợp
    const [staff] = await this.dataSource.query(
      'SELECT id, full_name, role FROM users WHERE id = ? AND deleted_at IS NULL',
      [dto.staffUserId],
    );
    if (!staff) {
      throw new NotFoundException('Không tìm thấy nhân viên.');
    }
    if (staff.role === 'CUSTOMER') {
      throw new BadRequestException('Không thể phân công khách hàng vào quản lý khách sạn.');
    }

    // Kiểm tra trùng lặp
    const existing = await this.hotelStaffRepository.findOne({
      where: {
        hotelId: dto.hotelId,
        staffUserId: dto.staffUserId,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Nhân viên "${staff.full_name}" đã được phân công cho khách sạn "${hotel.name}" rồi.`,
      );
    }

    const assignment = this.hotelStaffRepository.create({
      hotelId: dto.hotelId,
      staffUserId: dto.staffUserId,
      staffRole: dto.staffRole ?? 'EMPLOYEE',
      status: 'ACTIVE',
    });

    const saved = await this.hotelStaffRepository.save(assignment);

    return {
      message: `Đã phân công nhân viên "${staff.full_name}" vào khách sạn "${hotel.name}" thành công.`,
      data: saved,
    };
  }

  /**
   * Lấy danh sách nhân viên được phân công cho khách sạn.
   */
  async getStaffByHotel(hotelId: string) {
    const data = await this.dataSource.query(
      `
      SELECT
        hs.id,
        hs.hotel_id AS hotelId,
        hs.staff_user_id AS staffUserId,
        hs.staff_role AS staffRole,
        hs.status,
        hs.assigned_at AS assignedAt,
        u.full_name AS staffName,
        u.email AS staffEmail,
        u.phone AS staffPhone,
        u.avatar_url AS staffAvatarUrl,
        u.role AS userRole
      FROM hotel_staff hs
      LEFT JOIN users u ON u.id = hs.staff_user_id
      WHERE hs.hotel_id = ?
      ORDER BY hs.assigned_at DESC
      `,
      [hotelId],
    );

    return { data };
  }

  /**
   * Lấy tất cả phân công nhân viên.
   */
  async findAll() {
    const data = await this.dataSource.query(`
      SELECT
        hs.id,
        hs.hotel_id AS hotelId,
        hs.staff_user_id AS staffUserId,
        hs.staff_role AS staffRole,
        hs.status,
        hs.assigned_at AS assignedAt,
        u.full_name AS staffName,
        u.email AS staffEmail,
        h.name AS hotelName
      FROM hotel_staff hs
      LEFT JOIN users u ON u.id = hs.staff_user_id
      LEFT JOIN hotels h ON h.id = hs.hotel_id
      ORDER BY hs.assigned_at DESC
    `);

    return { data };
  }

  /**
   * Gỡ phân công nhân viên khỏi khách sạn.
   */
  async removeAssignment(id: string) {
    const assignment = await this.hotelStaffRepository.findOne({
      where: { id },
    });

    if (!assignment) {
      throw new NotFoundException('Không tìm thấy phân công nhân viên.');
    }

    await this.hotelStaffRepository.delete(id);

    return {
      success: true,
      message: 'Đã gỡ phân công nhân viên khỏi khách sạn thành công.',
    };
  }
}
