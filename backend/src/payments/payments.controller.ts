import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CheckoutSessionDto } from './dto/checkout-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Khởi tạo checkout session & lấy URL thanh toán VNPay
   * POST /payments/checkout-sessions
   */
  @Post('checkout-sessions')
  @UseGuards(JwtAuthGuard)
  createCheckoutSession(
    @Body() dto: CheckoutSessionDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    return this.paymentsService.createCheckoutSession(
      dto,
      user.id,
      ip.split(',')[0].trim(),
    );
  }

  /**
   * Endpoint IPN (Instant Payment Notification) từ cổng thanh toán VNPay
   * GET /payments/vnpay/ipn
   */
  @Get('vnpay/ipn')
  processVnpayIpn(@Query() query: Record<string, any>) {
    return this.paymentsService.processVnpayIpn(query);
  }

  /**
   * Kiểm tra trạng thái thanh toán của booking
   * GET /payments/status/:bookingId
   */
  @Get('status/:bookingId')
  @UseGuards(JwtAuthGuard)
  getPaymentStatus(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: User,
  ) {
    return this.paymentsService.getPaymentStatus(bookingId, user.id);
  }

  /**
   * Kiểm tra trạng thái thanh toán theo txnRef (Return URL của VNPay)
   * GET /payments/status-by-ref/:txnRef
   */
  @Get('status-by-ref/:txnRef')
  @UseGuards(JwtAuthGuard)
  getPaymentStatusByTxnRef(
    @Param('txnRef') txnRef: string,
    @CurrentUser() user: User,
  ) {
    return this.paymentsService.getPaymentStatusByTxnRef(txnRef, user);
  }

  /**
   * Thử lại thanh toán cho booking chưa thanh toán hoặc đã hết hạn
   * POST /payments/:bookingId/attempts
   */
  @Post(':bookingId/attempts')
  @UseGuards(JwtAuthGuard)
  retryPayment(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    return this.paymentsService.retryPayment(
      bookingId,
      user.id,
      ip.split(',')[0].trim(),
    );
  }

  /**
   * Đối soát giao dịch với VNPay qua QueryDr
   * POST /payments/:bookingId/reconcile
   */
  @Post(':bookingId/reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  reconcilePayment(@Param('bookingId') bookingId: string) {
    return this.paymentsService.reconcilePayment(bookingId);
  }

  /**
   * Yêu cầu hoàn tiền (Admin)
   * POST /payments/:bookingId/refund
   */
  @Post(':bookingId/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  requestRefund(
    @Param('bookingId') bookingId: string,
    @Body() body: { amount: number; reason: string },
    @CurrentUser() user: User,
  ) {
    return this.paymentsService.requestRefund(
      bookingId,
      body.amount,
      body.reason || 'Hoan tien theo yeu cau Admin',
      user.id,
    );
  }
}
