import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { ServiceRequest } from '../services/entities/service-request.entity';
import { RoomService } from '../services/entities/room-service.entity';
import { PaymentTransaction } from '../payments/entities/payment-transaction.entity';
import { OutboxModule } from '../outbox/outbox.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { PromotionCampaign } from './entities/promotion-campaign.entity';
import { BookingPriceQuote } from './entities/booking-price-quote.entity';
import { BookingBenefitAccount } from './entities/booking-benefit-account.entity';
import { BookingBenefitLedger } from './entities/booking-benefit-ledger.entity';
import { PromotionRefundIntent } from './entities/promotion-refund-intent.entity';
import { BenefitConsentRecord } from './entities/benefit-consent-record.entity';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionCampaign,
      BookingPriceQuote,
      BookingBenefitAccount,
      BookingBenefitLedger,
      PromotionRefundIntent,
      BenefitConsentRecord,
      Booking,
      BookingRoom,
      Room,
      ServiceRequest,
      RoomService,
      PaymentTransaction,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
    OutboxModule,
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
