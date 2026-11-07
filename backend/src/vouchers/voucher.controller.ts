import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApplyVoucherDto } from './dto/apply-voucher.dto';
import { VoucherService } from './voucher.service';

@Controller('booking-price-quotes')
@UseGuards(JwtAuthGuard)
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Post(':id/voucher')
  async applyVoucher(
    @Param('id') quoteId: string,
    @Body() body: ApplyVoucherDto,
    @Req() req: any,
  ) {
    return this.voucherService.applyVoucherToQuote({
      quoteId,
      code: body?.code,
      userId: String(req.user?.sub || req.user?.id),
    });
  }
}
