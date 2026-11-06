import {
  Body,
  Controller,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrecheckinService } from './precheckin.service';

@Controller()
export class PrecheckinController {
  constructor(private readonly precheckinService: PrecheckinService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'USER'),
    };
  }

  @Post('bookings/:id/precheckin/invite')
  @UseGuards(JwtAuthGuard)
  async invite(@Param('id') bookingId: string, @Req() req: any) {
    return this.precheckinService.createInviteToken(bookingId, this.extractActor(req));
  }

  @Post('precheckin/:opaqueToken/submit')
  async submitByToken(
    @Param('opaqueToken') opaqueToken: string,
    @Body() body: any,
  ) {
    return this.precheckinService.submitByToken(opaqueToken, body);
  }

  @Post('bookings/:id/precheckin/review')
  @UseGuards(JwtAuthGuard)
  async review(
    @Param('id') bookingId: string,
    @Body() body: { approved: boolean; note?: string },
    @Req() req: any,
  ) {
    return this.precheckinService.reviewPrecheckin(bookingId, body, this.extractActor(req));
  }

  @Put('bookings/:id/occupants')
  @UseGuards(JwtAuthGuard)
  async upsertOccupants(
    @Param('id') bookingId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.precheckinService.upsertOccupants(bookingId, body, this.extractActor(req));
  }
}
