import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/users
   * Lấy danh sách nhân viên — chỉ ADMIN.
   */
  @Get()
  @Roles('ADMIN')
  async findAllStaff() {
    const data = await this.usersService.findAllStaff();
    return { success: true, data };
  }

  /**
   * GET /api/users/:id
   * Xem chi tiết nhân viên — chỉ ADMIN.
   */
  @Get(':id')
  @Roles('ADMIN')
  async findOneStaff(@Param('id') id: string) {
    const data = await this.usersService.findOneStaff(id);
    return { success: true, data };
  }

  /**
   * POST /api/users
   * Tạo tài khoản nhân viên mới — chỉ ADMIN.
   */
  @Post()
  @Roles('ADMIN')
  async createStaff(@Body() dto: CreateStaffDto) {
    const data = await this.usersService.createStaff(dto);
    return {
      success: true,
      message: 'Tạo tài khoản nhân viên thành công.',
      data,
    };
  }

  /**
   * PATCH /api/users/:id
   * Cập nhật thông tin nhân viên — chỉ ADMIN.
   */
  @Patch(':id')
  @Roles('ADMIN')
  async updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    const data = await this.usersService.updateStaff(id, dto);
    return {
      success: true,
      message: 'Cập nhật thông tin nhân viên thành công.',
      data,
    };
  }

  /**
   * DELETE /api/users/:id
   * Xóa mềm tài khoản nhân viên — chỉ ADMIN.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async removeStaff(@Param('id') id: string, @CurrentUser() user: User) {
    await this.usersService.removeStaff(id, user.id);
    return {
      success: true,
      message: 'Xóa tài khoản nhân viên thành công.',
    };
  }

  /**
   * PATCH /api/users/:id/role
   * Phân quyền role cho nhân viên — chỉ ADMIN.
   */
  @Patch(':id/role')
  @Roles('ADMIN')
  async assignRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.usersService.assignRole(id, dto, user.id);
    return {
      success: true,
      message: `Đã phân quyền "${dto.role}" cho nhân viên thành công.`,
      data,
    };
  }

  /**
   * PATCH /api/users/:id/status
   * Khoá / Mở khoá tài khoản — chỉ ADMIN.
   */
  @Patch(':id/status')
  @Roles('ADMIN')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: User,
  ) {
    const data = await this.usersService.updateStatus(id, dto, user.id);
    const label = dto.status === 'BLOCKED' ? 'Khoá' : 'Mở khoá';
    return {
      success: true,
      message: `${label} tài khoản nhân viên thành công.`,
      data,
    };
  }
}

