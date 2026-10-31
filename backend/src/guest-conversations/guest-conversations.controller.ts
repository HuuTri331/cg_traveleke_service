import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GuestConversationsService } from './guest-conversations.service';
import { CreateGuestMessageDto } from './dto/create-guest-message.dto';

@Controller('guest-conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuestConversationsController {
  constructor(private readonly conversationsService: GuestConversationsService) {}

  @Get('booking/:bookingId/messages')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getMessages(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
  ) {
    return await this.conversationsService.getMessages(bookingId, actor);
  }

  @Post('booking/:bookingId/messages')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async sendMessage(
    @Param('bookingId') bookingId: string,
    @CurrentUser() actor: { id: string; role: string },
    @Body() dto: CreateGuestMessageDto,
  ) {
    return await this.conversationsService.sendMessage(bookingId, actor, dto);
  }
}

