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
    return await this.coverageService.requestCoverage(bookingId, actor, {
      ...dto,
      requireDelegateAcceptance: true,
    });
  }

  @Post(':bookingId/requests')
  @Roles('ADMIN', 'EMPLOYEE')
  async requestCoverage(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body() dto: CreateTemporaryCoverageDto,
  ) {
    return await this.coverageService.requestCoverage(bookingId, actor, dto);
  }

  @Post(':bookingId/requests/:grantId/approve')
  @Roles('ADMIN', 'EMPLOYEE')
  async approveCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body('note') note?: string,
  ) {
    return await this.coverageService.approveCoverage(bookingId, grantId, actor, note);
  }

  @Post(':bookingId/requests/:grantId/accept')
  @Roles('ADMIN', 'EMPLOYEE')
  async acceptCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body('note') note?: string,
  ) {
    return await this.coverageService.acceptCoverage(bookingId, grantId, actor, note);
  }

  @Post(':bookingId/requests/:grantId/decline')
  @Roles('ADMIN', 'EMPLOYEE')
  async declineCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body('reason') reason?: string,
  ) {
    return await this.coverageService.declineCoverage(bookingId, grantId, actor, reason);
  }

  @Post(':bookingId/requests/:grantId/handback')
  @Roles('ADMIN', 'EMPLOYEE')
  async handbackCoverage(
    @Param('bookingId') bookingId: string,
    @Param('grantId') grantId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body('reason') reason?: string,
  ) {
    return await this.coverageService.handbackCoverage(bookingId, grantId, actor, reason);
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
  async getTimeline(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
  ) {
    return await this.coverageService.getCoverageTimeline(bookingId, actor);
  }

  @Get('hotel/:hotelId/active')
  @Roles('ADMIN', 'EMPLOYEE')
  async getActiveGrants(
    @Param('hotelId') hotelId: string,
    @CurrentUser() actor: { id: string; role: string },
  ) {
    return await this.coverageService.getActiveGrantsForHotel(hotelId, actor);
  }
}

