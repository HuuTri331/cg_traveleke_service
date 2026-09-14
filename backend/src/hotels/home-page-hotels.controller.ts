import { Controller, Get, Query } from '@nestjs/common';

import { QueryHotelDto } from './dto/query-hotel.dto';
import { HotelsService } from './hotels.service';

@Controller('HomePage/hotels')
export class HomePageHotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Get()
  findAll(@Query() query: QueryHotelDto) {
    return this.hotelsService.findAll(query);
  }
}