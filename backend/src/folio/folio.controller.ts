import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  PostFolioAdjustmentDto,
  RecordFolioSettlementDto,
} from './dto/folio.dto';
import { FolioService } from './folio.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FolioController {
  constructor(private readonly folioService: FolioService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'CUSTOMER'),
    };
  }

  @Get('bookings/:id/folio')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getBookingFolio(@Param('id') bookingId: string, @Req() req: any) {
    return this.folioService.getBookingFolio(bookingId, this.extractActor(req));
  }

  @Post('folios/:id/settlements')
  @Roles('ADMIN', 'EMPLOYEE')
  async recordSettlement(
    @Param('id') folioId: string,
    @Body() body: RecordFolioSettlementDto,
    @Req() req: any,
  ) {
    return this.folioService.recordSettlement(
      folioId,
      body,
      this.extractActor(req),
    );
  }

  @Post('folios/settlements/:settlementId/verify')
  @Roles('ADMIN', 'EMPLOYEE')
  async verifySettlement(
    @Param('settlementId') settlementId: string,
    @Req() req: any,
  ) {
    return this.folioService.verifySettlement(
      settlementId,
      this.extractActor(req),
    );
  }

  @Post('folios/:id/adjustments')
  @Roles('ADMIN', 'EMPLOYEE')
  async postAdjustment(
    @Param('id') folioId: string,
    @Body() body: PostFolioAdjustmentDto,
    @Req() req: any,
  ) {
    return this.folioService.postFourEyesAdjustment(
      folioId,
      body,
      this.extractActor(req),
    );
  }
}

