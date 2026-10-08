import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CancellationsService } from './cancellations.service';
import { CreateCancellationRequestDto } from './dto/create-cancellation-request.dto';
import { ReviewCancellationRequestDto } from './dto/review-cancellation-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../users/entities/user.entity';

@Controller('cancellations')
export class CancellationsController {
  constructor(private readonly cancellationsService: CancellationsService) {}

  /**
   * Khách hàng gửi yêu cầu hủy đơn đặt phòng (kèm hoàn tiền)
   * POST /cancellations/request
   */
  @Post('request')
  @UseGuards(JwtAuthGuard)
  createRequest(
    @Body() dto: CreateCancellationRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.cancellationsService.createRequest(dto, user);
  }

  /**
   * Quản lý khách sạn / Admin xét duyệt yêu cầu hủy đơn
   * PATCH /cancellations/:id/review
   */
  @Patch(':id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  reviewRequest(
    @Param('id') id: string,
    @Body() dto: ReviewCancellationRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.cancellationsService.reviewRequest(id, dto, user);
  }

  /**
   * Danh sách yêu cầu hủy (theo quyền)
   * GET /cancellations
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: User) {
    return this.cancellationsService.findAll(user);
  }

  /**
   * Chi tiết yêu cầu hủy
   * GET /cancellations/:id
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.cancellationsService.findOne(id, user);
  }
}
