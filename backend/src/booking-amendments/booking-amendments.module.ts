import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { StayTimeService } from '../stay-extras/stay-time.service';
import { BookingAmendmentsController } from './booking-amendments.controller';
import { BookingAmendmentsService } from './booking-amendments.service';
import {
  AmendmentHoldItem,
  BookingAmendment,
} from './entities/booking-amendment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookingAmendment, AmendmentHoldItem]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [BookingAmendmentsController],
  providers: [BookingAmendmentsService, StayTimeService],
  exports: [BookingAmendmentsService, StayTimeService],
})
export class BookingAmendmentsModule {}
