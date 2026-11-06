import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { Folio, FolioEntry, FolioSettlement } from './entities/folio.entity';
import { FolioPostingService } from './folio-posting.service';
import { FolioController } from './folio.controller';
import { FolioService } from './folio.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folio, FolioEntry, FolioSettlement]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [FolioController],
  providers: [FolioService, FolioPostingService],
  exports: [FolioService, FolioPostingService],
})
export class FolioModule {}
