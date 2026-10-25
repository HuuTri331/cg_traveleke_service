import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { StaffAvailabilityService } from './staff-availability.service';
import { CreateAbsenceRequestDto } from './dto/create-absence-request.dto';
import { DecideAbsenceRequestDto } from './dto/decide-absence-request.dto';
import { WithdrawAbsenceRequestDto } from './dto/withdraw-absence-request.dto';
import { AbsenceRequestStatus } from './entities/staff-absence-request.entity';

@Controller('staff-availability')
@UseGuards(JwtAuthGuard)
export class StaffAvailabilityController {
  constructor(
    private readonly staffAvailabilityService: StaffAvailabilityService,
  ) {}

  /**
   * Lễ tân nộp đơn xin nghỉ/đi muộn
   */
  @Post('requests')
  async submitRequest(
    @CurrentUser() user: User,
    @Body() dto: CreateAbsenceRequestDto,
  ) {
    const data = await this.staffAvailabilityService.submitRequest(user, dto);
    return {
      success: true,
      data,
      message: 'Nộp đơn xin phép vắng mặt thành công, đang chờ quản lý phê duyệt.',
    };
  }

  /**
   * Nhân viên xem danh sách các đơn của chính mình
   */
  @Get('requests/me')
  async getMyRequests(@CurrentUser() user: User) {
    const data = await this.staffAvailabilityService.getMyRequests(user);
    return {
      success: true,
      data,
    };
  }

  /**
   * Quản lý xem danh sách đơn của nhân viên theo khách sạn
   */
  @Get('requests/hotel/:hotelId')
  async getHotelRequests(
    @CurrentUser() user: User,
    @Param('hotelId') hotelId: string,
    @Query('status') status?: AbsenceRequestStatus,
  ) {
    const data = await this.staffAvailabilityService.getHotelRequests(
      user,
      hotelId,
      status,
    );
    return {
      success: true,
      data,
    };
  }

  /**
   * Quản lý xét duyệt đơn (APPROVE / REJECT)
   */
  @Post('requests/:id/decision')
  async decideRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: DecideAbsenceRequestDto,
  ) {
    const data = await this.staffAvailabilityService.decideRequest(user, id, dto);
    return {
      success: true,
      data,
      message:
        dto.decision === 'APPROVE'
          ? 'Đã phê duyệt đơn xin phép vắng mặt.'
          : 'Đã từ chối đơn xin phép vắng mặt.',
    };
  }

  /**
   * Nhân viên rút đơn vắng mặt
   */
  @Post('requests/:id/withdraw')
  async withdrawRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: WithdrawAbsenceRequestDto,
  ) {
    const data = await this.staffAvailabilityService.withdrawRequest(user, id, dto);
    return {
      success: true,
      data,
      message: 'Thao tác rút đơn thành công.',
    };
  }

  /**
   * Kiểm tra tình trạng khả dụng của một nhân viên tại thời điểm hiện tại
   */
  @Get('check/:hotelId/:staffUserId')
  async checkAvailability(
    @Param('hotelId') hotelId: string,
    @Param('staffUserId') staffUserId: string,
    @Query('at') atStr?: string,
  ) {
    const targetDate = atStr ? new Date(atStr) : new Date();
    const data = await this.staffAvailabilityService.isStaffAvailableAt(
      hotelId,
      staffUserId,
      targetDate,
    );
    return {
      success: true,
      data,
    };
  }
}
