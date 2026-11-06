import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomBlocksService } from './room-blocks.service';
import type { CreateRoomBlockDto } from './room-blocks.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class RoomBlocksController {
  constructor(private readonly roomBlocksService: RoomBlocksService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Post('hotels/:id/room-blocks/preview')
  async previewBlock(
    @Param('id') hotelId: string,
    @Body() dto: Omit<CreateRoomBlockDto, 'commandId'>,
    @Req() req: any,
  ) {
    return this.roomBlocksService.previewBlock(
      hotelId,
      dto,
      this.extractActor(req),
    );
  }

  @Post('hotels/:id/room-blocks')
  async createBlock(
    @Param('id') hotelId: string,
    @Body() dto: CreateRoomBlockDto,
    @Req() req: any,
  ) {
    return this.roomBlocksService.createBlock(
      hotelId,
      dto,
      this.extractActor(req),
    );
  }

  @Post('room-blocks/:id/release')
  async releaseBlock(@Param('id') blockId: string, @Req() req: any) {
    return this.roomBlocksService.releaseBlock(blockId, this.extractActor(req));
  }
}
