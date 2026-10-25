import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { BookingAssignmentService } from './booking-assignment.service';

@Controller('booking-assignments')
@UseGuards(JwtAuthGuard)
export class BookingAssignmentController {
  constructor(
    private readonly bookingAssignmentService: BookingAssignmentService,
  ) {}

  /**
   * Xem lịch sử và lý do phân công của một đơn đặt phòng
   */
  @Get(':bookingId/history')
  async getHistory(@Param('bookingId') bookingId: string) {
    const data = await this.bookingAssignmentService.getAssignmentHistory(bookingId);
    return {
      success: true,
      data,
    };
  }

  /**
   * Thủ công trigger phân công một booking đã thanh toán
   */
  @Post(':bookingId/assign')
  async triggerAssignment(@Param('bookingId') bookingId: string) {
    const data = await this.bookingAssignmentService.assignOnce(
      bookingId,
      'MANUAL_TRIGGER' as any,
    );
    return {
      success: data.success,
      data,
      message: data.reason,
    };
  }

  /**
   * Kích hoạt job rà soát và phân công bù cho các booking chưa có người
   */
  @Post('repair')
  async repairUnassigned() {
    const data = await this.bookingAssignmentService.repairUnassignedPaidBookings();
    return {
      success: true,
      data,
      message: `Đã hoàn tất phân công bù cho ${data.repairedCount} đơn đặt phòng.`,
    };
  }
}
