import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { IncidentAction, RoomIncident } from './entities/room-incident.entity';
import { RoomIncidentController } from './room-incident.controller';
import { RoomIncidentService } from './room-incident.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoomIncident, IncidentAction]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [RoomIncidentController],
  providers: [RoomIncidentService],
  exports: [RoomIncidentService],
})
export class RoomIncidentsModule {}
