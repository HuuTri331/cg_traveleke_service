import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HomePageHotelsController } from './home-page-hotels.controller';
import { HotelImage } from './entities/hotel-image.entity';
import { Hotel } from './entities/hotel.entity';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hotel, HotelImage])],
  controllers: [
    HotelsController,
    HomePageHotelsController,
  ],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
