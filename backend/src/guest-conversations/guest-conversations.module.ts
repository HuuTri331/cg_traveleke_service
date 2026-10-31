import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestConversation } from './entities/guest-conversation.entity';
import { GuestMessage } from './entities/guest-message.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestConversationsService } from './guest-conversations.service';
import { GuestConversationsController } from './guest-conversations.controller';
import { GuestWorkModule } from '../guest-work/guest-work.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuestConversation,
      GuestMessage,
      Booking,
    ]),
    GuestWorkModule,
    RealtimeModule,
  ],
  controllers: [GuestConversationsController],
  providers: [GuestConversationsService],
  exports: [GuestConversationsService],
})
export class GuestConversationsModule {}

