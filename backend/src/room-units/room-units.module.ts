import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingCoverageModule } from '../booking-coverage/booking-coverage.module';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { RoomUnitAllocationCommand } from './entities/room-unit-allocation-command.entity';
import { RoomUnitAllocation } from './entities/room-unit-allocation.entity';
import { RoomUnitAllocationEvent } from './entities/room-unit-allocation-event.entity';
import { RoomUnitStaySlot } from './entities/room-unit-stay-slot.entity';
import { RoomUnit } from './entities/room-unit.entity';
import { RoomAllocationService } from './room-allocation.service';
import { RoomMoveService } from './room-move.service';
import { RoomUnitBookingController, RoomUnitsController } from './room-units.controller';
import { RoomUnitsService } from './room-units.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoomUnit,
      RoomUnitAllocation,
      RoomUnitStaySlot,
      RoomUnitAllocationEvent,
      RoomUnitAllocationCommand,
    ]),
    StaffAvailabilityModule,
    BookingCoverageModule,
  ],
  controllers: [RoomUnitsController, RoomUnitBookingController],
  providers: [RoomUnitsService, RoomAllocationService, RoomMoveService],
  exports: [TypeOrmModule, RoomUnitsService, RoomAllocationService, RoomMoveService],
})
export class RoomUnitsModule {}
