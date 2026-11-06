import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FolioService } from './folio.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FolioController {
  constructor(private readonly folioService: FolioService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Get('bookings/:id/folio')
  async getBookingFolio(@Param('id') bookingId: string) {
    return this.folioService.getBookingFolio(bookingId);
  }

  @Post('folios/:id/settlements')
  async recordSettlement(
    @Param('id') folioId: string,
    @Body()
    body: {
      method: string;
      amountVnd: number;
      providerRef: string;
      evidenceUrl?: string;
      commandId: string;
    },
    @Req() req: any,
  ) {
    return this.folioService.recordSettlement(
      folioId,
      body,
      this.extractActor(req),
    );
  }

  @Post('folios/:id/adjustments')
  async postAdjustment(
    @Param('id') folioId: string,
    @Body()
    body: {
      direction: 'CREDIT' | 'DEBIT' | 'REVERSAL';
      amountVnd: number;
      reason: string;
      approvedByManagerId: string;
      reversesEntryId?: string;
      commandId: string;
    },
    @Req() req: any,
  ) {
    return this.folioService.postFourEyesAdjustment(
      folioId,
      body,
      this.extractActor(req),
    );
  }
}
