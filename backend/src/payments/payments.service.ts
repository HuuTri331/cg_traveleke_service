import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from './entities/payment-transaction.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room } from '../rooms/entities/room.entity';
import { BookingHold } from '../inventory/entities/booking-hold.entity';
import { VnpayService } from './vnpay.service';
import { InventoryService } from '../inventory/inventory.service';
import { OutboxService } from '../outbox/outbox.service';
import { BookingsService } from '../bookings/bookings.service';
import { BookingAccessService } from '../bookings/services/booking-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';
import { CheckoutSessionDto } from './dto/checkout-session.dto';
import { User } from '../users/entities/user.entity';

import { CheckoutService } from './services/checkout.service';
import { PaymentAttemptService } from './services/payment-attempt.service';
import { PaymentFinalizerService } from './services/payment-finalizer.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import { RefundService } from './services/refund.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingStatusLog)
    private readonly statusLogRepo: Repository<BookingStatusLog>,
    @InjectRepository(BookingRoom)
    private readonly bookingRoomRepo: Repository<BookingRoom>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(BookingHold)
    private readonly holdRepo: Repository<BookingHold>,
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
    private readonly checkoutService: CheckoutService,
    private readonly paymentAttemptService: PaymentAttemptService,
    private readonly paymentFinalizerService: PaymentFinalizerService,
    private readonly reconciliationService: PaymentReconciliationService,
    private readonly refundService: RefundService,
    @Optional()
    private readonly bookingAccessService?: BookingAccessService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
    @Optional()
    private readonly redisLockService?: RedisLockService,
  ) {}

  /**
   * Tạo Checkout Session + Giữ phòng (HOLD) + Tạo Booking (PAYMENT_PENDING) + Idempotency
   */
  async createCheckoutSession(
    dto: CheckoutSessionDto,
    userId: string,
    clientIp = '127.0.0.1',
  ) {
    return await this.checkoutService.createCheckoutSession(dto, userId, clientIp);
  }

  /**
   * Xử lý VNPay IPN (Server-to-Server)
   * Idempotent + Pessimistic Row Lock + Double Payment Defense
   */
  async processVnpayIpn(queryParams: Record<string, any>) {
    this.logger.log(
      `[VNPay IPN] Nhận callback IPN: ${JSON.stringify(queryParams)}`,
    );

    // 1. Kiểm tra chữ ký bảo mật HMAC-SHA512
    const isValidSignature = this.vnpayService.verifySignature(queryParams);
    if (!isValidSignature) {
      this.logger.warn(`[VNPay IPN] Chữ ký không hợp lệ!`);
      return { RspCode: '97', Message: 'Checksum failed' };
    }

    const txnRef = queryParams['vnp_TxnRef'];
    const vnpAmountRaw = Number(queryParams['vnp_Amount']);
    const vnpAmount = vnpAmountRaw / 100;
    const vnpResponseCode = queryParams['vnp_ResponseCode'];
    const vnpTransactionStatus = queryParams['vnp_TransactionStatus'];
    const vnpTransactionNo = queryParams['vnp_TransactionNo'];
    const vnpBankCode = queryParams['vnp_BankCode'];
    const vnpCardType = queryParams['vnp_CardType'];
    const vnpPayDateStr = queryParams['vnp_PayDate'];

    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        // 2. Row Lock payment transaction FOR UPDATE
        const payment = await manager.getRepository(PaymentTransaction).findOne({
          where: { txnRef },
          lock: { mode: 'pessimistic_write' },
        });

        if (!payment) {
          this.logger.warn(`[VNPay IPN] Không tìm thấy giao dịch: ${txnRef}`);
          return { RspCode: '01', Message: 'Order not found' };
        }

        // 3. Kiểm tra số tiền
        if (Math.abs(Number(payment.amount) - vnpAmount) > 1) {
          this.logger.warn(
            `[VNPay IPN] Sai lệch số tiền: DB=${payment.amount}, IPN=${vnpAmount}`,
          );
          return { RspCode: '04', Message: 'Invalid amount' };
        }

        // 4. Kiểm tra Idempotency
        if (payment.status === PaymentTransactionStatus.PAID) {
          this.logger.log(
            `[VNPay IPN] Giao dịch ${txnRef} đã được xử lý thành công trước đó (Idempotent OK).`,
          );
          return { RspCode: '02', Message: 'Order already confirmed' };
        }

        // 5. Tìm booking liên quan
        const booking = await manager.getRepository(Booking).findOne({
          where: { id: payment.bookingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!booking) {
          return { RspCode: '01', Message: 'Order not found' };
        }

        let payDate: Date | null = null;
        if (vnpPayDateStr && vnpPayDateStr.length === 14) {
          const y = Number(vnpPayDateStr.slice(0, 4));
          const m = Number(vnpPayDateStr.slice(4, 6)) - 1;
          const d = Number(vnpPayDateStr.slice(6, 8));
          const h = Number(vnpPayDateStr.slice(8, 10));
          const min = Number(vnpPayDateStr.slice(10, 12));
          const s = Number(vnpPayDateStr.slice(12, 14));
          payDate = new Date(Date.UTC(y, m, d, h - 7, min, s));
        }

        // 6. Xử lý kết quả giao dịch
        if (vnpResponseCode === '00' && vnpTransactionStatus === '00') {
          await this.paymentFinalizerService.finalizeSuccess(
            payment,
            booking,
            {
              responseCode: vnpResponseCode,
              transactionStatus: vnpTransactionStatus,
              vnpTransactionNo,
              bankCode: vnpBankCode,
              cardType: vnpCardType,
              payDate,
              rawResponse: queryParams,
            },
            manager,
            async (bId, mgr) => {
              await this.bookingsService.autoAssignStaffForPaidBooking(bId, mgr);
            },
          );
          return { RspCode: '00', Message: 'Confirm Success' };
        } else {
          // Thất bại hoặc hủy giao dịch
          payment.status = PaymentTransactionStatus.FAILED;
          payment.responseCode = vnpResponseCode;
          payment.transactionStatus = vnpTransactionStatus;
          payment.vnpTransactionNo = vnpTransactionNo;
          payment.bankCode = vnpBankCode;
          payment.cardType = vnpCardType;
          payment.payDate = payDate;
          payment.failedAt = new Date();
          payment.rawIpnResponse = queryParams;
          await manager.getRepository(PaymentTransaction).save(payment);

          // Giải phóng hold
          await this.inventoryService.releaseHold(
            booking.id,
            `Thanh toán thất bại (Mã lỗi VNPay: ${vnpResponseCode})`,
            manager,
          );

          await this.outboxService.addEvent(
            manager,
            'payment.failed',
            'Booking',
            booking.id,
            {
              bookingId: booking.id,
              bookingCode: booking.bookingCode,
              paymentId: payment.id,
              responseCode: vnpResponseCode,
              userId: booking.userId,
            },
          );

          return { RspCode: '00', Message: 'Confirm Success' };
        }
      },
      { contextName: 'PaymentsService.processVnpayIpn' },
    );
  }

  /**
   * Lấy trạng thái thanh toán của booking
   */
  async getPaymentStatus(bookingId: string, userId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }
    if (booking.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem thông tin này.');
    }

    const latestPayment = await this.paymentRepo.findOne({
      where: { bookingId },
      order: { attemptNo: 'DESC' },
    });

    const hold = await this.holdRepo.findOne({
      where: { bookingId },
    });

    return {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      bookingStatus: booking.status,
      paymentStatus: latestPayment?.status || 'NOT_FOUND',
      holdStatus: hold?.status || null,
      holdExpiresAt: hold?.holdExpiresAt?.toISOString() || null,
      paymentCutoffAt: latestPayment?.gatewayExpireAt?.toISOString() || null,
      estimatedTotal: Number(booking.estimatedTotal),
      latestAttemptNo: latestPayment?.attemptNo || 0,
      vnpTransactionNo: latestPayment?.vnpTransactionNo || null,
    };
  }

  /**
   * Lấy trạng thái thanh toán theo txnRef kèm Resource Authorization (Section 8)
   */
  async getPaymentStatusByTxnRef(txnRef: string, user?: User) {
    const payment = await this.paymentRepo.findOne({
      where: { txnRef },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy giao dịch.');
    }

    const booking = await this.bookingRepo.findOne({
      where: { id: payment.bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    // Resource Authorization Check (Section 8 & 9)
    if (user && this.bookingAccessService) {
      await this.bookingAccessService.assertCanView(
        { userId: booking.userId, hotelId: booking.hotelId },
        user,
      );
    }

    const hold = await this.holdRepo.findOne({
      where: { bookingId: booking.id },
    });

    return {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      txnRef: payment.txnRef,
      amount: Number(payment.amount),
      paymentStatus: payment.status,
      bookingStatus: booking.status,
      holdStatus: hold?.status || null,
      vnpTransactionNo: payment.vnpTransactionNo,
      bankCode: payment.bankCode,
      paidAt: payment.paidAt,
    };
  }

  /**
   * Thử lại thanh toán (Retry) sử dụng PaymentAttemptService (Section 4)
   */
  async retryPayment(
    bookingId: string,
    userId: string,
    clientIp = '127.0.0.1',
  ) {
    return await this.paymentAttemptService.retryPayment(
      bookingId,
      userId,
      clientIp,
      async (txnRef, queryDrResult) => {
        const payment = await this.paymentRepo.findOne({ where: { txnRef } });
        const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
        if (payment && booking) {
          await runWithDeadlockRetry(this.dataSource, async (manager) => {
            await this.paymentFinalizerService.finalizeSuccess(
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
          });
        }
      },
    );
  }

  /**
   * Đối soát trạng thái thanh toán thật với VNPay qua QueryDr
   */
  async reconcilePayment(bookingId: string) {
    return await this.reconciliationService.reconcilePayment(bookingId);
  }

  /**
   * Hoàn tiền cho giao dịch
   */
  async refundPayment(
    paymentId: string,
    amount: number,
    reason: string,
    adminEmail = 'admin@traveleke.com',
  ) {
    return await this.refundService.processRefund({
      paymentId,
      txnRef: '',
      amount,
      reason,
      createBy: adminEmail,
    });
  }

  /**
   * Yêu cầu hoàn tiền theo bookingId (Admin)
   */
  async requestRefund(
    bookingId: string,
    amount: number,
    reason: string,
    adminId: string,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { bookingId, status: PaymentTransactionStatus.PAID },
      order: { attemptNo: 'DESC' },
    });
    if (!payment) {
      throw new NotFoundException(
        'Không tìm thấy giao dịch thanh toán thành công để hoàn tiền.',
      );
    }
    return await this.refundService.processRefund({
      paymentId: payment.id,
      txnRef: payment.txnRef,
      amount,
      reason,
      createBy: adminId,
    });
  }
}
