import { Controller, Get, Param, Query } from '@nestjs/common';

import { HotelsService } from './hotels.service';
import { SearchHotelDto } from './dto/search-hotel.dto';

/**
 * Public endpoints for hotels — không yêu cầu xác thực (dành cho phía khách hàng).
 */
@Controller('HomePage/hotels')
export class HomePageHotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Get()
  findAll(@Query() query: SearchHotelDto) {
    return this.hotelsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hotelsService.findOne(id);
  }
}
