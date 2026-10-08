import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Room } from '../rooms/entities/room.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}