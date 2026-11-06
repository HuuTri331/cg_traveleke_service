import {
  Body,
  Controller,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NightAuditService } from './night-audit.service';

@Controller('hotels/:id/night-audit')
@UseGuards(JwtAuthGuard)
export class NightAuditController {
  constructor(private readonly nightAuditService: NightAuditService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Post('preview')
  async preview(
    @Param('id') hotelId: string,
    @Query('date') date?: string,
    @Req() req?: any,
  ) {
    return this.nightAuditService.previewNightAudit(
      hotelId,
      date,
      this.extractActor(req),
    );
  }

  @Post('close')
  async close(
    @Param('id') hotelId: string,
    @Body() body: { date: string; commandId: string },
    @Req() req: any,
  ) {
    return this.nightAuditService.closeNightAudit(
      hotelId,
      body?.date,
      body?.commandId,
      this.extractActor(req),
    );
  }
}
