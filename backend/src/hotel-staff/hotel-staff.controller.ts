import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';

import { AssignStaffDto } from './dto/assign-staff.dto';
import { HotelStaffService } from './hotel-staff.service';

@Controller('hotel-staff')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HotelStaffController {
  constructor(private readonly hotelStaffService: HotelStaffService) {}

  /**
   * POST /api/hotel-staff
   * Phân công nhân viên vào khách sạn — chỉ ADMIN.
   */
  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  async assignStaff(@Body() dto: AssignStaffDto, @CurrentUser() user?: User) {
    return this.hotelStaffService.assignStaff(dto, user);
  }

  /**
   * GET /api/hotel-staff
   * Lấy tất cả phân công — ADMIN/EMPLOYEE (EMPLOYEE chỉ nhận các khách sạn mình thuộc biên chế).
   */
  @Get()
  @Roles('ADMIN', 'EMPLOYEE')
  async findAll(@CurrentUser() user?: User) {
    return this.hotelStaffService.findAll(user);
  }

  /**
   * GET /api/hotel-staff/hotel/:hotelId
   * Lấy danh sách nhân viên theo khách sạn — ADMIN/EMPLOYEE (EMPLOYEE phải thuộc khách sạn đó).
   */
  @Get('hotel/:hotelId')
  @Roles('ADMIN', 'EMPLOYEE')
  async getStaffByHotel(@Param('hotelId') hotelId: string, @CurrentUser() user?: User) {
    return this.hotelStaffService.getStaffByHotel(hotelId, user);
  }

  /**
   * DELETE /api/hotel-staff/:id
   * Gỡ phân công — chỉ ADMIN.
   */
  @Delete(':id')
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async removeAssignment(@Param('id') id: string, @CurrentUser() user?: User) {
    return this.hotelStaffService.removeAssignment(id, user);
  }
}
