import { Module } from '@nestjs/common';
import { HotelAccessPolicyService } from './hotel-access-policy.service';
import { BookingCoverageModule } from '../../booking-coverage/booking-coverage.module';

@Module({
  imports: [BookingCoverageModule],
  providers: [HotelAccessPolicyService],
  exports: [HotelAccessPolicyService],
})
export class HotelAccessModule {}

