import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HomePageRoomController } from './home-page-room.controller';
import { HotelsModule } from '../hotels/hotels.module';
import { RoomImage } from './entities/room-image.entity';
import { Room } from './entities/room.entity';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

import { RoomServiceAssignment } from './entities/room-service-assignment.entity';
import { RoomService } from '../services/entities/room-service.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomImage,
      RoomServiceAssignment,
      RoomService,
    ]),
    HotelsModule,
  ],
  controllers: [RoomsController, HomePageRoomController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
