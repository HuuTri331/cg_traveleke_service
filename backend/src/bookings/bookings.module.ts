import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Room } from '../rooms/entities/room.entity';

import { Booking } from './entities/booking.entity';
import { BookingRoom } from './entities/booking-room.entity';
import { BookingStatusLog } from './entities/booking-status-log.entity';

import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { RoomAvailabilityService } from './room-availability.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingRoom,
      BookingStatusLog,
      Room,
    ]),
  ],

  controllers: [
    BookingsController,
  ],

  providers: [
    BookingsService,
    RoomAvailabilityService,
  ],

  exports: [
    BookingsService,
    RoomAvailabilityService,
  ],
})
export class BookingsModule {}