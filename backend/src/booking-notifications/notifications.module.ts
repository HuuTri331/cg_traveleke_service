import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  NotificationDelivery,
  NotificationIntent,
} from './entities/notification-intent.entity';
import { NotificationIntentService } from './notification-intent.service';
import { BookingNotificationsService } from './notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationIntent, NotificationDelivery])],
  providers: [BookingNotificationsService, NotificationIntentService],
  exports: [BookingNotificationsService, NotificationIntentService],
})
export class BookingNotificationsModule {}
