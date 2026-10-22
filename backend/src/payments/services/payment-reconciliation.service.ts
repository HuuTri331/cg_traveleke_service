import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { VnpayService } from '../vnpay.service';
import { PaymentFinalizerService } from './payment-finalizer.service';
import { BookingAccessService } from '../../bookings/services/booking-access.service';
import { runWithDeadlockRetry } from '../../common/database/transaction-retry.helper';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
    private readonly paymentFinalizerService: PaymentFinalizerService,
    @Optional()
    private readonly bookingAccessService?: BookingAccessService,
  ) {}

  /**
   * Đối soát trạng thái thực tế của giao dịch với VNPay qua QueryDr
   */
  async reconcilePayment(bookingId: string, user?: User) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    // Nếu người gọi là nhân viên/quản lý (user truyền từ Controller): kiểm tra quyền phụ trách hotel
    if (user && this.bookingAccessService) {
      await this.bookingAccessService.assertCanManage(booking, user);
    }

    const payment = await this.paymentRepo.findOne({
      where: { bookingId },
      order: { attemptNo: 'DESC' },
    });

    if (!payment) {
      throw new NotFoundException('Không tìm thấy giao dịch thanh toán.');
    }

    // Nếu đã PAID rồi thì trả về kết quả
    if (payment.status === PaymentTransactionStatus.PAID) {
      return {
        bookingId,
        txnRef: payment.txnRef,
        status: payment.status,
        message: 'Giao dịch đã được xác nhận thanh toán thành công.',
        data: payment,
      };
    }

    this.logger.log(
      `[Reconciliation] Gọi QueryDr đối soát cho giao dịch ${payment.txnRef}`,
    );

    const queryDrResult = await this.vnpayService.queryDr({
      txnRef: payment.txnRef,
      transactionDate: payment.createdAt,
    });

    if (
      queryDrResult?.vnp_ResponseCode === '00' &&
      queryDrResult?.vnp_TransactionStatus === '00'
    ) {
      const finalResult = await runWithDeadlockRetry(
        this.dataSource,
        async (manager) => {
          return await this.paymentFinalizerService.finalizeSuccess(
            payment,
            booking,
            {
              responseCode: queryDrResult.vnp_ResponseCode,
              transactionStatus: queryDrResult.vnp_TransactionStatus,
              vnpTransactionNo: queryDrResult.vnp_TransactionNo,
              bankCode: queryDrResult.vnp_BankCode,
              cardType: queryDrResult.vnp_CardType,
              payDate: new Date(),
              rawResponse: queryDrResult,
            },
            manager,
          );
        },
        { contextName: 'PaymentReconciliation.finalizeSuccess' },
      );

      const actualPaymentStatus =
        finalResult?.paymentStatus ||
        (finalResult?.success
          ? PaymentTransactionStatus.PAID
          : PaymentTransactionStatus.PAID_REQUIRES_REVIEW);

      return {
        bookingId,
        txnRef: payment.txnRef,
        status: actualPaymentStatus,
        bookingStatus: finalResult?.bookingStatus || booking.status,
        outcome: finalResult?.outcome || 'RECONCILED',
        message:
          finalResult?.message ||
          (finalResult?.success
            ? 'Đối soát thành công: Giao dịch đã thanh toán.'
            : 'Đối soát phát hiện trạng thái cần xem xét (Review/Refund).'),
        data: finalResult,
      };
    }

    return {
      bookingId,
      txnRef: payment.txnRef,
      status: payment.status,
      message: 'Đối soát hoàn tất: Trạng thái không thay đổi.',
      vnpayResponse: queryDrResult,
    };
  }
}
