import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Room } from '../rooms/entities/room.entity';
import { Booking } from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';
import { BookingStatusLog } from './entities/booking-status-log.entity';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { BookingPresenceEvent } from '../booking-presence/entities/booking-presence-event.entity';

import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingAccessService } from './services/booking-access.service';
import { BookingWritePolicy } from './services/booking-write-policy';
import { RoomAvailabilityService } from './room-availability.service';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { BookingPresenceModule } from '../booking-presence/booking-presence.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { OutboxModule } from '../outbox/outbox.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingRoom,
      BookingStatusLog,
      Room,
      HotelStaff,
      BookingPresenceEvent,
    ]),
    InventoryModule,
    BookingCoverageModule,
    BookingPresenceModule,
    forwardRef(() => PaymentsModule),
    OutboxModule,
    RedisModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingAccessService, BookingWritePolicy, RoomAvailabilityService],
  exports: [BookingsService, BookingAccessService, BookingWritePolicy, RoomAvailabilityService],
})
export class BookingsModule {}
