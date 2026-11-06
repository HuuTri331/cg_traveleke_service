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
import { DocumentGeneratorService } from './document-generator.service';
import { BookingDocumentType } from './entities/booking-document.entity';

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly docService: DocumentGeneratorService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'USER'),
    };
  }

  @Get('bookings/:id/documents')
  async listDocuments(@Param('id') bookingId: string, @Req() req: any) {
    return this.docService.listDocuments(bookingId, this.extractActor(req));
  }

  @Post('bookings/:id/documents/issue')
  async issueDocument(
    @Param('id') bookingId: string,
    @Body()
    body: {
      type: BookingDocumentType;
      amountVnd?: number;
      buyerInfoJson?: Record<string, any>;
      commandId: string;
    },
    @Req() req: any,
  ) {
    return this.docService.issueDocument(
      bookingId,
      body,
      this.extractActor(req),
    );
  }
}
