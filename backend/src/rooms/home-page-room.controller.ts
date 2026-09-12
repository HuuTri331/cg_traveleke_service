import { Controller, Get, Query } from '@nestjs/common';

import { QueryRoomDto } from './dto/query-room.dto';
import { RoomsService } from './rooms.service';

@Controller('HomePage/room')
export class HomePageRoomController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  findAll(@Query() query: QueryRoomDto) {
    return this.roomsService.findAll(query);
  }
}