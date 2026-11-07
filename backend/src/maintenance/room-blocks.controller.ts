import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomBlocksService } from './room-blocks.service';

export class PreviewRoomBlockBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  roomTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  unitId?: string;

  @IsOptional()
  @IsIn(['OUT_OF_ORDER', 'OUT_OF_SERVICE', 'STOP_SELL'])
  blockType?: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE' | 'STOP_SELL';

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  startDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  endDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  blockedQuantity?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreateRoomBlockBodyDto extends PreviewRoomBlockBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;
}

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
    @Body() dto: PreviewRoomBlockDtoOrAlias,
    @Req() req: any,
  ) {
    return this.roomBlocksService.previewBlock(
      hotelId,
      dto as any,
      this.extractActor(req),
    );
  }

  @Post('hotels/:id/room-blocks')
  async createBlock(
    @Param('id') hotelId: string,
    @Body() dto: CreateRoomBlockBodyDto,
    @Req() req: any,
  ) {
    return this.roomBlocksService.createBlock(
      hotelId,
      dto as any,
      this.extractActor(req),
    );
  }

  @Post('room-blocks/:id/release')
  async releaseBlock(@Param('id') blockId: string, @Req() req: any) {
    return this.roomBlocksService.releaseBlock(blockId, this.extractActor(req));
  }
}
type PreviewRoomBlockDtoOrAlias = PreviewRoomBlockBodyDto;
