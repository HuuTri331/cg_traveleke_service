import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestWorkTask } from './entities/guest-work-task.entity';
import { GuestWorkEvent } from './entities/guest-work-event.entity';
import { GuestWorkEvidence } from './entities/guest-work-evidence.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkService } from './guest-work.service';
import { GuestWorkController } from './guest-work.controller';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuestWorkTask,
      GuestWorkEvent,
      GuestWorkEvidence,
      Booking,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
    RealtimeModule,
  ],
  controllers: [GuestWorkController],
  providers: [GuestWorkService],
  exports: [GuestWorkService],
})
export class GuestWorkModule {}

