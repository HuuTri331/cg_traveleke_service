import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { VnpayService } from './vnpay.service';
import { InventoryModule } from '../inventory/inventory.module';
import { OutboxModule } from '../outbox/outbox.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RedisModule } from '../redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      Booking,
      BookingStatusLog,
      BookingRoom,
      Room,
    ]),
    InventoryModule,
    OutboxModule,
    forwardRef(() => BookingsModule),
    RedisModule,
    RealtimeModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, VnpayService],
  exports: [PaymentsService, VnpayService],
})
export class PaymentsModule {}
