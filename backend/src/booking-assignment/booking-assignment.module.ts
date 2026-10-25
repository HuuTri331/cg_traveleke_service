import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingAssignment } from './entities/booking-assignment.entity';
import { BookingAssignmentState } from './entities/booking-assignment-state.entity';
import { HotelAssignmentDispatchLock } from './entities/hotel-assignment-dispatch-lock.entity';
import { BookingAssignmentCommandReceipt } from './entities/booking-assignment-command-receipt.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';
import { BookingAssignmentService } from './booking-assignment.service';
import { BookingAssignmentController } from './booking-assignment.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingAssignment,
      BookingAssignmentState,
      HotelAssignmentDispatchLock,
      BookingAssignmentCommandReceipt,
      Booking,
      BookingRoom,
      Room,
    ]),
    StaffAvailabilityModule,
  ],
  controllers: [BookingAssignmentController],
  providers: [BookingAssignmentService],
  exports: [BookingAssignmentService],
})
export class BookingAssignmentModule {}
