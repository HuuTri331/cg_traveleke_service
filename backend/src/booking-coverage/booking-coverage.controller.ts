import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingCoverageService } from './booking-coverage.service';
import { CreateTemporaryCoverageDto } from './dto/create-temporary-coverage.dto';
import { ExtendCoverageDto } from './dto/extend-coverage.dto';
import { PermanentTransferDto } from './dto/permanent-transfer.dto';

@Controller('booking-coverage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingCoverageController {
  constructor(private readonly coverageService: BookingCoverageService) {}

  @Post(':bookingId/temporary')
  @Roles('ADMIN', 'EMPLOYEE')
  async createTemporary(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body() dto: CreateTemporaryCoverageDto,
  ) {
    return await this.coverageService.createTemporary(bookingId, actor, dto);
  }

  @Post(':bookingId/temporary/:grantId/extend')
  @Roles('ADMIN', 'EMPLOYEE')
  async extendCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body() dto: ExtendCoverageDto,
  ) {
    return await this.coverageService.extend(bookingId, grantId, actor, dto);
  }

  @Post(':bookingId/temporary/:grantId/revoke')
  @Roles('ADMIN', 'EMPLOYEE')
  async revokeCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body('reason') reason?: string,
  ) {
    return await this.coverageService.revoke(bookingId, grantId, actor, reason);
  }

  @Post(':bookingId/permanent-transfer')
  @Roles('ADMIN', 'EMPLOYEE')
  async permanentTransfer(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body() dto: PermanentTransferDto,
  ) {
    return await this.coverageService.transferPermanent(bookingId, actor, dto);
  }

  @Get(':bookingId/timeline')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getTimeline(@Param('bookingId') bookingId: string) {
    return await this.coverageService.getCoverageTimeline(bookingId);
  }

  @Get('hotel/:hotelId/active')
  @Roles('ADMIN', 'EMPLOYEE')
  async getActiveGrants(@Param('hotelId') hotelId: string) {
    return await this.coverageService.getActiveGrantsForHotel(hotelId);
  }
}

