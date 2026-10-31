import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GuestStaffReviewsService } from './guest-staff-reviews.service';
import { SubmitStaffReviewDto, UpdateStaffReviewDto } from './dto/kpi.dto';

@Controller('staff-reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuestStaffReviewsController {
  constructor(private readonly reviewService: GuestStaffReviewsService) {}

  @Get('booking/:bookingId/eligible')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getEligibleTargets(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string },
  ) {
    return await this.reviewService.getEligibleReviewTargets(bookingId, user.id);
  }

  @Post()
  @Roles('ADMIN', 'CUSTOMER')
  async submitReview(
    @CurrentUser() user: { id: string },
    @Body() dto: SubmitStaffReviewDto,
  ) {
    return await this.reviewService.submitReview(user.id, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'CUSTOMER')
  async updateReview(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateStaffReviewDto,
  ) {
    return await this.reviewService.updateReview(id, user.id, dto);
  }
}

