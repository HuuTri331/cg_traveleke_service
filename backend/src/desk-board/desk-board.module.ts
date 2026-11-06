import { Module } from '@nestjs/common';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { DeskBoardController } from './desk-board.controller';
import { DeskBoardService } from './desk-board.service';

@Module({
  imports: [StaffAvailabilityModule, BookingCoverageModule],
  controllers: [DeskBoardController],
  providers: [DeskBoardService],
  exports: [DeskBoardService],
})
export class DeskBoardModule {}
