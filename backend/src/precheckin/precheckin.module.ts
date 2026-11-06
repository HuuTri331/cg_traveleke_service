import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import {
  BookingGuestOccupant,
  PrecheckinSubmission,
  PrecheckinToken,
} from './entities/precheckin.entity';
import { PrecheckinController } from './precheckin.controller';
import { PrecheckinService } from './precheckin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrecheckinSubmission,
      PrecheckinToken,
      BookingGuestOccupant,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [PrecheckinController],
  providers: [PrecheckinService],
  exports: [PrecheckinService],
})
export class PrecheckinModule {}
