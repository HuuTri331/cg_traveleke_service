import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { PropertySettingsService } from './property-settings.service';
import type { UpdateHotelBusinessSettingDto } from './property-settings.service';

@Controller('hotels/:hotelId/property-settings')
@UseGuards(JwtAuthGuard)
export class PropertySettingsController {
  constructor(
    private readonly propertySettingsService: PropertySettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  @Get()
  async getSettings(@Param('hotelId') hotelId: string) {
    return this.propertySettingsService.getHotelSettings(hotelId);
  }

  @Patch()
  async updateSettings(
    @Param('hotelId') hotelId: string,
    @Body() dto: UpdateHotelBusinessSettingDto,
    @Req() req: any,
  ) {
    return this.propertySettingsService.updateHotelSettings(hotelId, dto, {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    });
  }

  @Post('feature-flags')
  async setFeatureFlag(
    @Param('hotelId') hotelId: string,
    @Body() body: { flagKey: string; enabled: boolean },
    @Req() req: any,
  ) {
    return this.propertySettingsService.toggleFeatureFlag(
      hotelId,
      body.flagKey,
      Boolean(body.enabled),
      {
        id: String(req.user?.sub || req.user?.id),
        role: String(req.user?.role || 'STAFF'),
      },
    );
  }

  @Get('feature-flags/:flagKey')
  async getFeatureFlag(
    @Param('hotelId') hotelId: string,
    @Param('flagKey') flagKey: string,
  ) {
    const enabled = await this.featureFlagsService.isEnabled(hotelId, flagKey);
    return { hotelId, flagKey, enabled };
  }
}
