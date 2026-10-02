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

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

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
  @Roles('ADMIN')
  async assignStaff(@Body() dto: AssignStaffDto) {
    return this.hotelStaffService.assignStaff(dto);
  }

  /**
   * GET /api/hotel-staff
   * Lấy tất cả phân công — ADMIN/EMPLOYEE.
   */
  @Get()
  @Roles('ADMIN', 'EMPLOYEE')
  async findAll() {
    return this.hotelStaffService.findAll();
  }

  /**
   * GET /api/hotel-staff/hotel/:hotelId
   * Lấy danh sách nhân viên theo khách sạn — ADMIN/EMPLOYEE.
   */
  @Get('hotel/:hotelId')
  @Roles('ADMIN', 'EMPLOYEE')
  async getStaffByHotel(@Param('hotelId') hotelId: string) {
    return this.hotelStaffService.getStaffByHotel(hotelId);
  }

  /**
   * DELETE /api/hotel-staff/:id
   * Gỡ phân công — chỉ ADMIN.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async removeAssignment(@Param('id') id: string) {
    return this.hotelStaffService.removeAssignment(id);
  }
}
