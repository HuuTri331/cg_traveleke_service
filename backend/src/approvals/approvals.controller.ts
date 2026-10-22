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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { ApprovalsService } from './approvals.service';
import {
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
} from './dto/approval.dto';
import { ApprovalStatus } from './entities/approval-request.entity';

@Controller('approval-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  create(
    @Body() dto: CreateApprovalRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.approvalsService.createRequest(dto, user);
  }

  @Get('hotel/:hotelId')
  @Roles('ADMIN', 'EMPLOYEE')
  getHotelRequests(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: User,
    @Query('status') status?: ApprovalStatus,
  ) {
    return this.approvalsService.getRequests(hotelId, user, status);
  }

  @Patch(':id/decide')
  @Roles('ADMIN', 'EMPLOYEE')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideApprovalRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.approvalsService.decide(id, dto, user);
  }
}
