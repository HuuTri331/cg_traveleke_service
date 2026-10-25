import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAbsenceRequest } from './entities/staff-absence-request.entity';
import { StaffAbsenceRequestEvent } from './entities/staff-absence-request-event.entity';
import { StaffAvailabilityBlock } from './entities/staff-availability-block.entity';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { StaffAvailabilityService } from './staff-availability.service';
import { StaffAvailabilityController } from './staff-availability.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StaffAbsenceRequest,
      StaffAbsenceRequestEvent,
      StaffAvailabilityBlock,
      HotelStaff,
    ]),
  ],
  controllers: [StaffAvailabilityController],
  providers: [StaffAvailabilityService],
  exports: [StaffAvailabilityService],
})
export class StaffAvailabilityModule {}
