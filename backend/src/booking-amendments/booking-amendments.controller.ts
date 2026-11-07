import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StayTimeService } from '../stay-extras/stay-time.service';
import { BookingAmendmentsService } from './booking-amendments.service';
import {
  QuoteBookingAmendmentBodyDto,
  RequestBookingAmendmentBodyDto,
  StayTimeRequestBodyDto,
} from './dto/booking-amendments.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class BookingAmendmentsController {
  constructor(
    private readonly amendmentsService: BookingAmendmentsService,
    private readonly stayTimeService: StayTimeService,
  ) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'USER'),
    };
  }

  @Post('bookings/:id/amendments/quote')
  async quoteAmendment(
    @Param('id') bookingId: string,
    @Body() dto: QuoteBookingAmendmentBodyDto,
    @Req() req: any,
  ) {
    return this.amendmentsService.quoteAmendment(
      bookingId,
      dto,
      this.extractActor(req),
    );
  }

  @Post('bookings/:id/amendments')
  async createAmendment(
    @Param('id') bookingId: string,
    @Body() dto: RequestBookingAmendmentBodyDto,
    @Req() req: any,
  ) {
    return this.amendmentsService.createAmendment(
      bookingId,
      dto,
      this.extractActor(req),
    );
  }

  @Post('booking-amendments/:id/accept')
  async acceptAmendment(@Param('id') amendmentId: string, @Req() req: any) {
    return this.amendmentsService.acceptAmendment(
      amendmentId,
      this.extractActor(req),
    );
  }

  @Post('bookings/:id/stay-time-requests')
  async requestStayTime(
    @Param('id') bookingId: string,
    @Body() body: StayTimeRequestBodyDto,
    @Req() req: any,
  ) {
    return this.stayTimeService.requestStayTimeExtension(
      { ...body, bookingId },
      this.extractActor(req),
    );
  }
}
