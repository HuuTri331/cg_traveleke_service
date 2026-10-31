import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  async getHistory(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.bookingAssignmentService.getAssignmentHistory(bookingId, user);
    return {
      success: true,
      data,
    };
  }

  /**
   * Thủ công trigger phân công một booking đã thanh toán (chỉ Quản lý hoặc Admin)
   */
  @Post(':bookingId/assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async triggerAssignment(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: User,
  ) {
    const data = await this.bookingAssignmentService.triggerAssignmentForAuthorizedUser(
      bookingId,
      user,
    );
    return {
      success: data.success,
      data,
      message: data.reason,
    };
  }

  /**
   * Kích hoạt job rà soát và phân công bù cho các booking chưa có người (Chỉ ADMIN)
   */
  @Post('repair')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async repairUnassigned() {
    const data = await this.bookingAssignmentService.repairUnassignedPaidBookings();
    return {
      success: true,
      data,
      message: `Đã hoàn tất phân công bù cho ${data.repairedCount} đơn đặt phòng.`,
    };
  }
}
