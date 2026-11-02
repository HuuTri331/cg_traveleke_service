import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { VnpayService } from '../vnpay.service';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
  ) {}

  /**
   * Xử lý gọi VNPay Refund API cho payment transaction
   */
  async processRefund(params: {
    paymentId?: string;
    txnRef: string;
    amount: number;
    transactionNo?: string;
    transactionDate?: Date | string;
    createBy?: string;
    reason?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    this.logger.log(
      `[RefundService] Bắt đầu gọi VNPay Refund API cho txnRef ${params.txnRef}, số tiền: ${params.amount}`,
    );

    const paymentRepo = this.dataSource.getRepository(PaymentTransaction);

    let payment: PaymentTransaction | null = null;
    if (params.paymentId) {
      payment = await paymentRepo.findOne({ where: { id: params.paymentId } });
    } else {
      payment = await paymentRepo.findOne({ where: { txnRef: params.txnRef } });
    }

    const paidTotal = payment ? Number(payment.amount || 0) : Number(params.amount || 0);
    const prevRefunded = payment ? Number(payment.refundAmount || 0) : 0;
    const maxRemainingRefundable = Math.max(0, paidTotal - prevRefunded);
    const effectiveRefundAmount =
      paidTotal > 0 ? Math.min(Number(params.amount || 0), maxRemainingRefundable) : Number(params.amount || 0);

    if (payment && effectiveRefundAmount <= 0) {
      this.logger.warn(
        `[RefundService] Giao dịch ${params.txnRef} đã hoàn đủ (${prevRefunded}/${paidTotal}), bỏ qua hoàn trùng.`,
      );
      return { success: true, data: { vnp_ResponseCode: '00', alreadyRefunded: true } };
    }

    const tDate = params.transactionDate
      ? new Date(params.transactionDate)
      : payment?.payDate || payment?.paidAt || new Date();

    const refundRes = await this.vnpayService.refund({
      txnRef: params.txnRef,
      amount: effectiveRefundAmount,
      transactionNo: params.transactionNo || payment?.vnpTransactionNo || '0',
      transactionDate: tDate,
      createBy: params.createBy || 'RefundServiceWorker',
    });

    if (refundRes?.vnp_ResponseCode === '00') {
      if (payment) {
        const newTotalRefunded = prevRefunded + effectiveRefundAmount;
        // IT19 / B28: Partial refund (e.g. 160k or 360k on 5M) keeps status PAID with accumulated refundAmount;
        // only mark REFUNDED when the entire paid amount has been refunded.
        if (paidTotal > 0 && newTotalRefunded >= paidTotal) {
          payment.status = PaymentTransactionStatus.REFUNDED;
        }
        payment.refundAmount = newTotalRefunded.toFixed(2);
        payment.refundedAt = new Date();
        payment.refundNote = params.reason || 'VNPay Refund Success';
        await paymentRepo.save(payment);
      }

      this.logger.log(
        `[RefundService] VNPay Refund thành công cho ${params.txnRef}`,
      );
      return { success: true, data: refundRes };
    } else {
      this.logger.error(
        `[RefundService] VNPay Refund thất bại cho ${params.txnRef}: ${refundRes?.vnp_Message || refundRes?.vnp_ResponseCode}`,
      );
      return {
        success: false,
        error: refundRes?.vnp_Message || `Response code: ${refundRes?.vnp_ResponseCode}`,
      };
    }
  }
}
