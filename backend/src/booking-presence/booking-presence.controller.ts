import {
  Body,
  Controller,
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
import { BookingPresenceService } from './booking-presence.service';
import { ConfirmArrivalDto } from './dto/confirm-arrival.dto';
import { ConfirmDepartureDto } from './dto/confirm-departure.dto';
import { LateArrivalNoticeDto } from './dto/late-arrival-notice.dto';

@Controller('booking-presence')
@UseGuards(JwtAuthGuard)
export class BookingPresenceController {
  constructor(private readonly presenceService: BookingPresenceService) {}

  /**
   * Xác nhận khách nhận phòng tại quầy (Check-in hoặc Late Check-In Recovery)
   * POST /booking-presence/:bookingId/check-in
   */
  @Post(':bookingId/check-in')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async confirmArrival(
    @Param('bookingId') bookingId: string,
    @Body() dto: ConfirmArrivalDto,
    @CurrentUser() user: User,
  ) {
    return this.presenceService.confirmArrival(
      bookingId,
      user.id,
      user.role,
      dto,
    );
  }

  /**
   * Xác nhận khách trả phòng (Check-out)
   * POST /booking-presence/:bookingId/check-out
   */
  @Post(':bookingId/check-out')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async confirmDeparture(
    @Param('bookingId') bookingId: string,
    @Body() dto: ConfirmDepartureDto,
    @CurrentUser() user: User,
  ) {
    return this.presenceService.confirmDeparture(
      bookingId,
      user.id,
      user.role,
      dto,
    );
  }

  /**
   * Khách hàng gửi thông báo dự kiến đến muộn
   * POST /booking-presence/:bookingId/late-arrival-notice
   */
  @Post(':bookingId/late-arrival-notice')
  @HttpCode(HttpStatus.OK)
  async recordLateArrivalNotice(
    @Param('bookingId') bookingId: string,
    @Body() dto: LateArrivalNoticeDto,
    @CurrentUser() user: User,
  ) {
    return this.presenceService.recordLateArrivalNotice(
      bookingId,
      user.id,
      dto,
    );
  }

  /**
   * Lấy nhật ký dòng thời gian hiện diện của booking
   * GET /booking-presence/:bookingId/timeline
   */
  @Get(':bookingId/timeline')
  async getPresenceTimeline(@Param('bookingId') bookingId: string) {
    return this.presenceService.getPresenceTimeline(bookingId);
  }

  /**
   * Xem thống kê lượt đến, No-show, in-house tại khách sạn
   * GET /booking-presence/hotel/:hotelId/arrivals
   */
  @Get('hotel/:hotelId/arrivals')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async getArrivalsSummary(@Param('hotelId') hotelId: string) {
    return this.presenceService.getArrivalsSummary(hotelId);
  }

  /**
   * Kích hoạt đánh dấu No-show thủ công cho quản lý
   * POST /booking-presence/:bookingId/mark-no-show
   */
  @Post(':bookingId/mark-no-show')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.OK)
  async markNoShowManual(@Param('bookingId') bookingId: string) {
    const booking = await this.presenceService.markNoShowIfEligible(
      bookingId,
      'Quản lý kiểm tra và đánh dấu No-Show thủ công tại quầy',
    );
    return {
      success: true,
      data: booking,
      message: 'Đã cập nhật trạng thái No-Show cho đơn đặt phòng thành công.',
    };
  }
}
