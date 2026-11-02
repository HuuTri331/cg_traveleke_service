import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageGrant } from './entities/booking-coverage-grant.entity';
import { BookingCoverageEvent } from './entities/booking-coverage-event.entity';
import { StaffAbsenceRequest } from '../staff-availability/entities/staff-absence-request.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingAssignment } from '../booking-assignment/entities/booking-assignment.entity';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { GuestWorkEvent } from '../guest-work/entities/guest-work-event.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { BookingCoverageService } from './booking-coverage.service';
import { BookingCoverageController } from './booking-coverage.controller';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingCoverageGrant,
      BookingCoverageEvent,
      StaffAbsenceRequest,
      Booking,
      BookingAssignment,
      BookingAssignmentState,
      GuestWorkTask,
      GuestWorkEvent,
    ]),
    StaffAvailabilityModule,
    RealtimeModule,
  ],
  controllers: [BookingCoverageController],
  providers: [BookingCoverageService],
  exports: [BookingCoverageService],
})
export class BookingCoverageModule {}

