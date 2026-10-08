import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { BookingHold } from '../inventory/entities/booking-hold.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { VnpayService } from './vnpay.service';
import { InventoryModule } from '../inventory/inventory.module';
import { OutboxModule } from '../outbox/outbox.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RedisModule } from '../redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';

import { CheckoutService } from './services/checkout.service';
import { PaymentAttemptService } from './services/payment-attempt.service';
import { PaymentFinalizerService } from './services/payment-finalizer.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import { RefundService } from './services/refund.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      Booking,
      BookingStatusLog,
      BookingRoom,
      Room,
      BookingHold,
    ]),
    InventoryModule,
    OutboxModule,
    forwardRef(() => BookingsModule),
    RedisModule,
    RealtimeModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    VnpayService,
    CheckoutService,
    PaymentAttemptService,
    PaymentFinalizerService,
    PaymentReconciliationService,
    RefundService,
  ],
  exports: [
    PaymentsService,
    VnpayService,
    CheckoutService,
    PaymentAttemptService,
    PaymentFinalizerService,
    PaymentReconciliationService,
    RefundService,
  ],
})
export class PaymentsModule {}
