import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { FolioModule } from '../folio/folio.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { DocumentGeneratorService } from './document-generator.service';
import { DocumentsController } from './documents.controller';
import { BookingDocument } from './entities/booking-document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookingDocument]),
    FolioModule,
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentGeneratorService],
  exports: [DocumentGeneratorService],
})
export class BookingDocumentsModule {}
