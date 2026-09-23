import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';

import { CreateBookingDto } from './dto/create-booking.dto';
import { QueryBookingDto } from './dto/query-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { ReassignStaffDto } from './dto/reassign-staff.dto';
import { BookingsService } from './bookings.service';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
  ) {}

  // ================================
  // TẠO BOOKING (Khách hàng đăng nhập)
  // Tầng 1 (IP): Tối đa 30 request/phút
  // Tầng 2 (User): Token bucket capacity 10, refillRate 0.5 token/s
  // ================================
  @Post()
  @UseGuards(JwtAuthGuard, RateLimiterGuard)
  @RateLimit({
    slidingWindow: {
      limit: 30,
      windowMs: 60_000,
    },
    tokenBucket: {
      capacity: 10,
      refillRate: 0.5,
    },
  })
  create(
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.create(dto);
  }

  // ================================
  // DANH SÁCH BOOKINGS (Admin/Employee)
  // ================================
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  findAll(@Query() query: QueryBookingDto) {
    return this.bookingsService.findAll(query);
  }

  // ================================
  // THỐNG KÊ DASHBOARD (Admin/Employee)
  // ================================
  @Get('statistics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getStatistics() {
    return this.bookingsService.getStatistics();
  }

  // ================================
  // NHẬT KÝ VẬN HÀNH / ACTIVITY LOGS (Admin/Employee)
  // ================================
  @Get('activity-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getActivityLogs(@Query('limit') limit?: number) {
    return this.bookingsService.getActivityLogs(limit ? Number(limit) : 50);
  }

  // ================================
  // LỊCH SỬ BOOKING CỦA USER (Customer)
  // ================================
  @Get('user/:userId')
  findByUser(
    @Param('userId') userId: string,
  ) {
    return this.bookingsService.findByUser(
      userId,
    );
  }

  // ================================
  // CHI TIẾT BOOKING
  // ================================
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(
    @Param('id') id: string,
  ) {
    return this.bookingsService.findOne(id);
  }

  // ================================
  // CẬP NHẬT TRẠNG THÁI BOOKING (Admin/Employee)
  // ================================
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
    @CurrentUser() user: User,
  ) {
    const result = await this.bookingsService.updateStatus(id, dto, user.id);
    return {
      success: true,
      ...result,
    };
  }

  // ================================
  // DANH SÁCH NHÂN VIÊN KHẢ DỤNG ĐỂ PHÂN CÔNG (Admin/Employee)
  // ================================
  @Get(':id/available-staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getAvailableStaff(@Param('id') id: string) {
    return this.bookingsService.getAvailableStaffForBooking(id);
  }

  // ================================
  // PHÂN CÔNG LẠI NHÂN VIÊN PHỤ TRÁCH (Admin/Employee)
  // ================================
  @Patch(':id/reassign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignStaffDto,
    @CurrentUser() user: User,
  ) {
    const result = await this.bookingsService.reassignStaff(
      id,
      dto.staffUserId,
      user.id,
      dto.note,
    );
    return {
      success: true,
      ...result,
    };
  }
}