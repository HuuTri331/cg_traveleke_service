import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkersService } from './workers.service';
import { OutboxModule } from '../outbox/outbox.module';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsModule } from '../payments/payments.module';
import { InventoryModule } from '../inventory/inventory.module';
import { GuestWorkModule } from '../guest-work/guest-work.module';
import { BookingAssignmentModule } from '../booking-assignment/booking-assignment.module';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OutboxModule,
    MailModule,
    RealtimeModule,
    PaymentsModule,
    InventoryModule,
    BookingAssignmentModule,
    GuestWorkModule,
    PromotionsModule,
  ],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
