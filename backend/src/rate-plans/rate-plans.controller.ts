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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { RateResolverService } from './rate-resolver.service';

export class CreateRatePlanBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  roomTypeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  mealPlan?: string;

  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cancellationPolicyId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  baseOccupancy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraAdultFeeVnd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraChildFeeVnd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  floorPriceVnd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ceilingPriceVnd?: number;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class RateCalendarEntryItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  stayDate!: string;

  @IsNumber()
  @Min(0)
  baseVnd!: number;

  @IsOptional()
  @IsNumber()
  adjustmentVnd?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minimumNights?: number;

  @IsOptional()
  @IsBoolean()
  closed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seasonLabel?: string;
}

export class UpsertRateCalendarBodyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateCalendarEntryItemDto)
  entries!: RateCalendarEntryItemDto[];
}

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
    @Body() dto: CreateRatePlanBodyDto,
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
    @Body() body: UpsertRateCalendarBodyDto,
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
