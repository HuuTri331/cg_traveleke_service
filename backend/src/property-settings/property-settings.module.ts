import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingWritePolicy } from '../bookings/services/booking-write-policy';
import { HotelBusinessSetting } from './entities/hotel-business-setting.entity';
import { HotelFeatureFlag } from './entities/hotel-feature-flag.entity';
import { FeatureFlagsService } from './feature-flags.service';
import { PropertyClockService } from './property-clock.service';
import { PropertySettingsController } from './property-settings.controller';
import { PropertySettingsService } from './property-settings.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([HotelBusinessSetting, HotelFeatureFlag])],
  controllers: [PropertySettingsController],
  providers: [
    PropertyClockService,
    FeatureFlagsService,
    PropertySettingsService,
    BookingWritePolicy,
  ],
  exports: [
    PropertyClockService,
    FeatureFlagsService,
    PropertySettingsService,
    BookingWritePolicy,
  ],
})
export class PropertySettingsModule {}
