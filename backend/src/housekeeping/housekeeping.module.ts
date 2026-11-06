import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { RoomUnit } from '../room-units/entities/room-unit.entity';
import { HousekeepingEvent } from './entities/housekeeping-event.entity';
import { HousekeepingTask } from './entities/housekeeping-task.entity';
import { HousekeepingController } from './housekeeping.controller';
import { HousekeepingService } from './housekeeping.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HousekeepingTask, HousekeepingEvent, RoomUnit]),
    OutboxModule,
  ],
  controllers: [HousekeepingController],
  providers: [HousekeepingService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
