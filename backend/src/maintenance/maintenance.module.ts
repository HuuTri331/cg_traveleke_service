import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomUnit } from '../room-units/entities/room-unit.entity';
import {
  RoomTypeStopSellRule,
  RoomUnitBlock,
} from './entities/room-block.entity';
import { RoomBlocksController } from './room-blocks.controller';
import { RoomBlocksService } from './room-blocks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoomUnitBlock, RoomTypeStopSellRule, RoomUnit]),
  ],
  controllers: [RoomBlocksController],
  providers: [RoomBlocksService],
  exports: [RoomBlocksService],
})
export class MaintenanceModule {}
