import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingPresenceEvent } from './entities/booking-presence-event.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { BookingPresenceService } from './booking-presence.service';
import { PresenceSchedulerService } from './presence-scheduler.service';
import { BookingPresenceController } from './booking-presence.controller';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingPresenceEvent,
      BookingStatusLog,
      HotelStaff,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [BookingPresenceController],
  providers: [BookingPresenceService, PresenceSchedulerService],
  exports: [BookingPresenceService],
})
export class BookingPresenceModule {}
