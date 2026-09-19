import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HotelStaff } from './entities/hotel-staff.entity';
import { HotelStaffController } from './hotel-staff.controller';
import { HotelStaffService } from './hotel-staff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HotelStaff]),
  ],
  controllers: [HotelStaffController],
  providers: [HotelStaffService],
  exports: [HotelStaffService],
})
export class HotelStaffModule {}
