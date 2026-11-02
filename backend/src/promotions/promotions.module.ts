import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { PromotionCampaign } from './entities/promotion-campaign.entity';
import { BookingPriceQuote } from './entities/booking-price-quote.entity';
import { BookingBenefitAccount } from './entities/booking-benefit-account.entity';
import { BookingBenefitLedger } from './entities/booking-benefit-ledger.entity';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionCampaign,
      BookingPriceQuote,
      BookingBenefitAccount,
      BookingBenefitLedger,
      Booking,
      BookingRoom,
      Room,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
