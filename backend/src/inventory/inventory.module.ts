import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingHold } from './entities/booking-hold.entity';
import { Room } from '../rooms/entities/room.entity';
import { InventoryService } from './inventory.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookingHold, Room]),
    RedisModule,
  ],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
