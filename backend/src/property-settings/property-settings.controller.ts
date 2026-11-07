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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ToggleFeatureFlagDto,
  UpdateHotelBusinessSettingRequestDto,
} from './dto/property-settings.dto';
import { FeatureFlagsService } from './feature-flags.service';
import { PropertySettingsService } from './property-settings.service';

@Controller('hotels/:hotelId/property-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PropertySettingsController {
  constructor(
    private readonly propertySettingsService: PropertySettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  private extractActor(req: any) {
    return {
      id: String(req?.user?.sub || req?.user?.id || ''),
      role: String(req?.user?.role || 'CUSTOMER'),
    };
  }

  @Get('public')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getPublicPolicy(@Param('hotelId') hotelId: string) {
    return this.propertySettingsService.getPublicHotelPolicy(hotelId);
  }

  @Get()
  @Roles('ADMIN', 'EMPLOYEE')
  async getSettings(@Param('hotelId') hotelId: string, @Req() req: any) {
    return this.propertySettingsService.getHotelSettingsForActor(
      hotelId,
      this.extractActor(req),
    );
  }

  @Patch()
  @Roles('ADMIN', 'EMPLOYEE')
  async updateSettings(
    @Param('hotelId') hotelId: string,
    @Body() dto: UpdateHotelBusinessSettingRequestDto,
    @Req() req: any,
  ) {
    return this.propertySettingsService.updateHotelSettings(
      hotelId,
      dto,
      this.extractActor(req),
    );
  }

  @Post('feature-flags')
  @Roles('ADMIN', 'EMPLOYEE')
  async setFeatureFlag(
    @Param('hotelId') hotelId: string,
    @Body() body: ToggleFeatureFlagDto,
    @Req() req: any,
  ) {
    return this.propertySettingsService.toggleFeatureFlag(
      hotelId,
      body.flagKey,
      Boolean(body.enabled),
      this.extractActor(req),
    );
  }

  @Get('feature-flags/:flagKey')
  @Roles('ADMIN', 'EMPLOYEE')
  async getFeatureFlag(
    @Param('hotelId') hotelId: string,
    @Param('flagKey') flagKey: string,
    @Req() req: any,
  ) {
    await this.propertySettingsService.assertStaffAccess(
      hotelId,
      this.extractActor(req),
    );
    const enabled = await this.featureFlagsService.isEnabled(hotelId, flagKey);
    return { hotelId, flagKey, enabled };
  }
}
