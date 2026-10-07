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
  Req,
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
  constructor(private readonly bookingsService: BookingsService) {}

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
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    dto.userId = user.id;
    const ip =
      (req.headers?.['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress ||
      '127.0.0.1';
    return this.bookingsService.create(dto, ip.split(',')[0].trim());
  }

  // ================================
  // THỬ LẠI THANH TOÁN (Payment Retry - Section 31)
  // POST /bookings/:id/payment-attempts
  // ================================
  @Post(':id/payment-attempts')
  @UseGuards(JwtAuthGuard)
  retryPayment(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    const ip =
      (req.headers?.['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress ||
      '127.0.0.1';
    return this.bookingsService.retryPayment(id, user.id, ip.split(',')[0].trim());
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
  // LỊCH SỬ BOOKING CỦA USER HIỆN TẠI (Customer JWT)
  // ================================
  @Get('me')
  @UseGuards(JwtAuthGuard)
  findMyBookings(@CurrentUser() user: User) {
    return this.bookingsService.findByUser(user.id);
  }

  // ================================
  // LỊCH SỬ BOOKING THEO USER ID (Admin/Employee tra cứu)
  // ================================
  @Get('user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  findByUser(@Param('userId') userId: string) {
    return this.bookingsService.findByUser(userId);
  }

  // ================================
  // CHI TIẾT BOOKING
  // ================================
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
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
