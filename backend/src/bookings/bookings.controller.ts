import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
  ) {}

  // ================================
  // TẠO BOOKING
  // ================================
  @Post()
  create(
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.create(dto);
  }

  // ================================
  // LỊCH SỬ BOOKING CỦA USER
  // ================================
  @Get('user/:userId')
  findByUser(
    @Param('userId') userId: string,
  ) {
    return this.bookingsService.findByUser(
      userId,
    );
  }

  // ================================
  // CHI TIẾT BOOKING
  // ================================
  @Get(':id')
  findOne(
    @Param('id') id: string,
  ) {
    return this.bookingsService.findOne(id);
  }
}