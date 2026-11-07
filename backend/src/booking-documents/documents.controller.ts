import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DocumentGeneratorService } from './document-generator.service';
import { BookingDocumentType } from './entities/booking-document.entity';

export class IssueBookingDocumentDto {
  @IsEnum(BookingDocumentType)
  type!: BookingDocumentType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountVnd?: number;

  @IsOptional()
  @IsObject()
  buyerInfoJson?: Record<string, any>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;
}

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
    @Body() body: IssueBookingDocumentDto,
    @Req() req: any,
  ) {
    return this.docService.issueDocument(
      bookingId,
      body,
      this.extractActor(req),
    );
  }
}
