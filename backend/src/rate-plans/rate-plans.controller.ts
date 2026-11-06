import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { RateResolverService } from './rate-resolver.service';

@Controller()
export class RatePlansController {
  constructor(
    private readonly rateResolver: RateResolverService,
    private readonly propertyClock: PropertyClockService,
  ) {}

  @Post('hotels/:id/rate-plans')
  @UseGuards(JwtAuthGuard)
  async createRatePlan(
    @Param('id') hotelId: string,
    @Body() dto: any,
    @Req() req: any,
  ) {
    return this.rateResolver.createRatePlan(hotelId, dto, {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    });
  }

  @Put('rate-plans/:id/calendar')
  @UseGuards(JwtAuthGuard)
  async upsertCalendar(
    @Param('id') ratePlanId: string,
    @Body() body: { entries: any[] },
    @Req() req: any,
  ) {
    return this.rateResolver.upsertCalendarEntries(
      ratePlanId,
      body?.entries || [],
      {
        id: String(req.user?.sub || req.user?.id),
        role: String(req.user?.role || 'STAFF'),
      },
    );
  }

  @Get('rooms/:id/rates')
  async getRoomRates(
    @Param('id') roomTypeId: string,
    @Query('hotelId') hotelId: string,
    @Query('checkIn') checkIn: string,
    @Query('checkOut') checkOut: string,
    @Query('ratePlanId') ratePlanId?: string,
  ) {
    const stayDates = this.propertyClock.enumerateStayNights(checkIn, checkOut);
    return this.rateResolver.resolveStayRates({
      hotelId: String(hotelId || '1'),
      roomTypeId,
      stayDates,
      ratePlanId: ratePlanId || null,
    });
  }
}
