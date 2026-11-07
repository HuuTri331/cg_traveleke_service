import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller('chat')
@UseGuards(RateLimiterGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @RateLimit({
    slidingWindow: {
      limit: 20,
      windowMs: 60_000,
    },
  })
  chat(@Body() dto: ChatMessageDto) {
    return this.chatService.chat(dto.message);
  }
}