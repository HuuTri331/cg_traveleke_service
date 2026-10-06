import { Body, Controller, Post } from '@nestjs/common';

import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  chat(@Body() dto: ChatMessageDto) {
    return this.chatService.chat(dto.message);
  }
}