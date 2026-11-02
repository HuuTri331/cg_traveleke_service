import {
  Body,
  Controller,
  ForbiddenException,
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
   * (Chỉ Quản lý hoặc chính nhân viên mới được xem chi tiết lý do; vai trò khác chỉ nhận boolean khả dụng)
   */
  @Get('check/:hotelId/:staffUserId')
  async checkAvailability(
    @Param('hotelId') hotelId: string,
    @Param('staffUserId') staffUserId: string,
    @CurrentUser() user: User,
    @Query('at') atStr?: string,
  ) {
    // Kiểm tra quyền
    const isSelf = String(user.id) === staffUserId;
    const isAdmin = user.role === 'ADMIN';

    if (!isAdmin && !isSelf) {
      const isStaffOfHotel = await this.staffAvailabilityService.isStaffAtHotel(
        String(user.id),
        hotelId,
      );
      if (!isStaffOfHotel) {
        throw new ForbiddenException(
          'Bạn không có quyền kiểm tra trạng thái nhân sự tại khách sạn này.',
        );
      }
    }

    const targetDate = atStr ? new Date(atStr) : new Date();
    const data = await this.staffAvailabilityService.isStaffAvailableAt(
      hotelId,
      staffUserId,
      targetDate,
    );

    const isManager =
      isAdmin ||
      (await this.staffAvailabilityService.isManagerAtHotel(String(user.id), hotelId));

    // Nếu không phải là Manager, Admin hoặc chính nhân sự: ẩn thông tin chi tiết lý do nghỉ (redaction)
    if (!isManager && !isSelf) {
      return {
        success: true,
        data: {
          available: data.available,
        },
      };
    }

    return {
      success: true,
      data,
    };
  }

  /**
   * D1-07: Xem danh sách các booking và tác vụ bị ảnh hưởng bởi đơn nghỉ/đi muộn
   */
  @Get('requests/:id/impact')
  async getRequestImpact(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    const data = await this.staffAvailabilityService.getRequestImpact(user, id);
    return {
      success: true,
      data,
    };
  }

  /**
   * D1-07: Quản lý xác nhận vắng mặt khẩn cấp tạm thời có giới hạn giờ và lưu audit
   */
  @Post('emergency-unavailable')
  async createEmergencyUnavailable(
    @CurrentUser() user: User,
    @Body()
    dto: {
      hotelId: string;
      staffUserId: string;
      startAt?: string;
      endAt: string;
      reason: string;
    },
  ) {
    const data = await this.staffAvailabilityService.createEmergencyUnavailable(user, dto);
    return {
      success: true,
      data,
      message: 'Đã xác nhận trạng thái vắng mặt khẩn cấp tạm thời và quét các đơn bị ảnh hưởng.',
    };
  }

  /**
   * Quản lý kết thúc sớm khoảng vắng mặt khi nhân viên quay lại làm việc
   */
  @Post('blocks/:blockId/end')
  async endBlockEarly(
    @CurrentUser() user: User,
    @Param('blockId') blockId: string,
    @Body('note') note?: string,
  ) {
    const data = await this.staffAvailabilityService.endAvailabilityBlockEarly(user, blockId, note);
    return {
      success: true,
      data,
      message: 'Đã kết thúc khoảng vắng mặt, nhân sự sẵn sàng nhận phân công trở lại.',
    };
  }

  /**
   * Lấy danh sách các block vắng mặt đang hiệu lực tại khách sạn
   */
  @Get('blocks/hotel/:hotelId')
  async getActiveBlocksForHotel(
    @CurrentUser() user: User,
    @Param('hotelId') hotelId: string,
  ) {
    const data = await this.staffAvailabilityService.getActiveBlocksForHotel(user, hotelId);
    return {
      success: true,
      data,
    };
  }
}
