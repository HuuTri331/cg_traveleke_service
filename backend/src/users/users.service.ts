import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

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
   */
  async findAllStaff(): Promise<User[]> {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });
    return users.filter((u) => u.role === 'ADMIN' || u.role === 'EMPLOYEE');
  }

  /**
   * Tìm nhân viên theo ID.
   */
  async findOneStaff(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user || user.role === 'CUSTOMER') {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}.`);
    }

    return user;
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
      throw new ConflictException('Email này đã được sử dụng bởi tài khoản khác.');
    }

    const roleName = dto.role ?? 'EMPLOYEE';
    const roleEntity = await this.rolesRepository.findOne({ where: { name: roleName } });

    if (!roleEntity) {
      throw new BadRequestException(`Role "${roleName}" không tồn tại trong hệ thống.`);
    }

    const rawPassword = dto.password?.trim() ? dto.password.trim() : '123456789';
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    const staff = this.usersRepository.create({
      fullName: dto.fullName,
      email: dto.email,
      password: hashedPassword,
      phone: dto.phone ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      status: 'ACTIVE',
      roles: [roleEntity],
    });

    const saved = await this.usersRepository.save(staff);
    delete (saved as unknown as Record<string, unknown>).password;
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
      throw new BadRequestException('Bạn không thể tự xóa tài khoản của chính mình.');
    }

    const user = await this.findOneStaff(id);
    await this.usersRepository.softDelete(user.id);
  }

  /**
   * Phân quyền role cho nhân viên (chỉ ADMIN được gọi).
   */
  async assignRole(id: string, dto: AssignRoleDto, requestUserId: string): Promise<User> {
    if (id === requestUserId) {
      throw new BadRequestException('Bạn không thể thay đổi role của chính mình.');
    }

    const user = await this.findOneStaff(id);

    const roleEntity = await this.rolesRepository.findOne({ where: { name: dto.role } });
    if (!roleEntity) {
      throw new BadRequestException(`Role "${dto.role}" không tồn tại trong hệ thống.`);
    }

    user.roles = [roleEntity];

    return this.usersRepository.save(user);
  }

  /**
   * Khoá / Mở khoá tài khoản nhân viên (chỉ ADMIN được gọi).
   */
  async updateStatus(id: string, dto: UpdateStatusDto, requestUserId: string): Promise<User> {
    if (id === requestUserId) {
      throw new BadRequestException('Bạn không thể thay đổi trạng thái tài khoản của chính mình.');
    }

    const user = await this.findOneStaff(id);
    user.status = dto.status;

    return this.usersRepository.save(user);
  }
}
