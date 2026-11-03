import { Global, Module } from '@nestjs/common';
import { HotelAccessPolicyService } from './hotel-access-policy.service';
import { HotelScopeResolver } from './hotel-scope-resolver.service';
import { BookingCoverageModule } from '../../booking-coverage/booking-coverage.module';

@Global()
@Module({
  imports: [BookingCoverageModule],
  providers: [HotelAccessPolicyService, HotelScopeResolver],
  exports: [HotelAccessPolicyService, HotelScopeResolver],
})
export class HotelAccessModule {}


