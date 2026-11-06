import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeskBoardService } from './desk-board.service';

@Controller('hotels/:id/desk')
@UseGuards(JwtAuthGuard)
export class DeskBoardController {
  constructor(private readonly deskBoardService: DeskBoardService) {}

  @Get('today')
  async getTodayBoard(
    @Param('id') hotelId: string,
    @Query('businessDate') businessDate?: string,
    @Req() req?: any,
  ) {
    return this.deskBoardService.getTodayBoard(hotelId, businessDate, {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    });
  }
}
