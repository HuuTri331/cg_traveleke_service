import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkersService } from './workers.service';
import { OutboxModule } from '../outbox/outbox.module';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsModule } from '../payments/payments.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OutboxModule,
    MailModule,
    RealtimeModule,
    PaymentsModule,
    InventoryModule,
  ],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
