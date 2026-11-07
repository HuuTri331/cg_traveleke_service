import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { In, Repository } from 'typeorm';

import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  /**
   * Lấy danh sách tất cả nhân viên (ADMIN & EMPLOYEE), không trả về CUSTOMER.
   * Lọc trực tiếp ở tầng CSDL sử dụng Index `idx_users_role`, tránh scan toàn bộ bảng vào RAM.
   */
  async findAllStaff() {
    const users = await this.usersRepository.find({
      where: { role: In(['ADMIN', 'EMPLOYEE']) },
      order: { createdAt: 'DESC' },
    });
    return users.map((u) => ({
      ...u,
      role: u.role,
      isEmailVerified: u.isEmailVerified,
    }));
  }

  /**
   * Lấy danh sách tất cả khách hàng (role = 'CUSTOMER') — ADMIN & EMPLOYEE
   * Lọc trực tiếp ở tầng CSDL sử dụng Index `idx_users_role`, tối ưu hiệu năng và bộ nhớ.
   */
  async findAllCustomers(
    actor?: User | { id: string; role: string },
    options?: { hotelId?: string; search?: string; page?: number; limit?: number },
  ) {
    const safeLimit = Math.min(Math.max(Number(options?.limit || 100), 1), 100);
    const safePage = Math.max(Number(options?.page || 1), 1);
    const offset = (safePage - 1) * safeLimit;
    const searchTerm = options?.search?.trim().toLowerCase();

    if (actor && actor.role === 'EMPLOYEE') {
      if (options?.hotelId) {
        const staffCheck = await this.usersRepository.manager.query(
          `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [actor.id, String(options.hotelId)],
        );
        if (!Array.isArray(staffCheck) || staffCheck.length === 0) {
          throw new ForbiddenException(
            'CROSS_HOTEL_FORBIDDEN: Nhân viên không được phép truy vấn danh sách khách hàng của khách sạn khác.',
          );
        }
      }

      const params: any[] = [actor.id];
      let hotelFilterSql = '';
      if (options?.hotelId) {
        hotelFilterSql = ' AND b.hotel_id = ?';
        params.push(String(options.hotelId));
      }

      const rows = await this.usersRepository.manager.query(
        `SELECT DISTINCT
           u.id,
           u.full_name AS fullName,
           u.email,
           u.phone,
           u.gender,
           u.avatar_url AS avatarUrl,
           u.role,
           u.status,
           u.email_verified_at AS emailVerifiedAt,
           u.last_login_at AS lastLoginAt,
           u.created_at AS createdAt,
           u.updated_at AS updatedAt
         FROM users u
         INNER JOIN bookings b ON b.user_id = u.id
         INNER JOIN hotel_staff hs ON hs.hotel_id = b.hotel_id
           AND hs.staff_user_id = ?
           AND hs.status = 'ACTIVE'
         WHERE u.role = 'CUSTOMER' AND u.deleted_at IS NULL${hotelFilterSql}
         ORDER BY u.created_at DESC`,
        params,
      );
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((u: any) => {
        if (!searchTerm) return true;
        return (
          String(u.fullName || '').toLowerCase().includes(searchTerm) ||
          String(u.email || '').toLowerCase().includes(searchTerm) ||
          String(u.phone || '').toLowerCase().includes(searchTerm)
        );
      });
      return filteredRows.slice(offset, offset + safeLimit).map((u: any) => ({
        id: String(u.id),
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        address: null,
        gender: u.gender,
        dateOfBirth: null,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
        isEmailVerified: Boolean(u.emailVerifiedAt),
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }));
    }

    const users = await this.usersRepository.find({
      where: { role: 'CUSTOMER' },
      order: { createdAt: 'DESC' },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      address: u.address,
      gender: u.gender,
      dateOfBirth: u.dateOfBirth,
      avatarUrl: u.avatarUrl,
      role: u.role,
      status: u.status,
      isEmailVerified: u.isEmailVerified,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  }

  /**
   * Cập nhật trạng thái tài khoản khách hàng toàn sàn (chỉ ADMIN)
   */
  async updateCustomerStatus(
    id: string,
    dto: UpdateStatusDto,
    requestUserId?: string,
    actor?: User | { id: string; role: string },
  ) {
    if (actor && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên hệ thống (ADMIN) mới có quyền khóa/mở khóa tài khoản khách hàng toàn sàn.',
      );
    }
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user || user.role !== 'CUSTOMER') {
      throw new NotFoundException(`Không tìm thấy khách hàng với ID ${id}.`);
    }

    user.status = dto.status;
    return this.usersRepository.save(user);
  }

  /**
   * Tìm nhân viên theo ID.
   */
  async findOneStaff(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user || user.role === 'CUSTOMER') {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}.`);
    }

    return {
      ...user,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
    };
  }

  /**
   * Tạo tài khoản nhân viên mới (chỉ ADMIN được gọi).
   */
  async createStaff(dto: CreateStaffDto): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    if (existing) {
      throw new ConflictException(
        'Email này đã được sử dụng bởi tài khoản khác.',
      );
    }

    const roleName = dto.role ?? 'EMPLOYEE';
    const roleEntity = await this.rolesRepository.findOne({
      where: { name: roleName },
    });

    if (!roleEntity) {
      throw new BadRequestException(
        `Role "${roleName}" không tồn tại trong hệ thống.`,
      );
    }

    // P2-06: Xóa mật khẩu mặc định dùng chung '123456789'; nếu không truyền mật khẩu thì sinh mật khẩu/token ngẫu nhiên mật mã học một lần
    const generatedOneTimeSecret = !dto.password?.trim()
      ? `Inv!${crypto.randomBytes(16).toString('base64url')}#9a`
      : null;
    const rawPassword = dto.password?.trim()
      ? dto.password.trim()
      : generatedOneTimeSecret!;
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    const staff = this.usersRepository.create({
      fullName: dto.fullName,
      email: dto.email,
      password: hashedPassword,
      phone: dto.phone ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      role: roleName,
      status: 'ACTIVE',
      roles: [roleEntity],
    });

    const saved = await this.usersRepository.save(staff);
    delete (saved as unknown as Record<string, unknown>).password;
    if (generatedOneTimeSecret) {
      (saved as any).requiresPasswordSetup = true;
    }
    return saved;
  }

  /**
   * Cập nhật thông tin nhân viên.
   */
  async updateStaff(id: string, dto: UpdateStaffDto): Promise<User> {
    const user = await this.findOneStaff(id);

    let hashedPassword: string | undefined;
    if (dto.password) {
      hashedPassword = await bcrypt.hash(dto.password, 12);
    }

    Object.assign(user, {
      ...(dto.fullName !== undefined && { fullName: dto.fullName }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.dateOfBirth !== undefined && { dateOfBirth: dto.dateOfBirth }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(hashedPassword !== undefined && { password: hashedPassword }),
    });

    const saved = await this.usersRepository.save(user);
    delete (saved as unknown as Record<string, unknown>).password;
    return saved;
  }

  /**
   * Xóa mềm tài khoản nhân viên.
   */
  async removeStaff(id: string, requestUserId: string): Promise<void> {
    if (id === requestUserId) {
      throw new BadRequestException(
        'Bạn không thể tự xóa tài khoản của chính mình.',
      );
    }

    const user = await this.findOneStaff(id);
    await this.usersRepository.softDelete(user.id);
  }

  /**
   * Phân quyền role cho nhân viên (chỉ ADMIN được gọi).
   */
  async assignRole(
    id: string,
    dto: AssignRoleDto,
    requestUserId: string,
  ): Promise<User> {
    if (id === requestUserId) {
      throw new BadRequestException(
        'Bạn không thể thay đổi role của chính mình.',
      );
    }

    const user = await this.findOneStaff(id);

    const roleEntity = await this.rolesRepository.findOne({
      where: { name: dto.role },
    });
    if (!roleEntity) {
      throw new BadRequestException(
        `Role "${dto.role}" không tồn tại trong hệ thống.`,
      );
    }

    user.roles = [roleEntity];
    user.role = dto.role as any;

    return this.usersRepository.save(user);
  }

  /**
   * Khoá / Mở khoá tài khoản nhân viên (chỉ ADMIN được gọi).
   */
  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    requestUserId: string,
  ): Promise<User> {
    if (id === requestUserId) {
      throw new BadRequestException(
        'Bạn không thể thay đổi trạng thái tài khoản của chính mình.',
      );
    }

    const user = await this.findOneStaff(id);
    user.status = dto.status;

    return this.usersRepository.save(user);
  }
}
