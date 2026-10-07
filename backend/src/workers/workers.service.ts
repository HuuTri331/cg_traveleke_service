import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { OutboxService } from '../outbox/outbox.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { VnpayService } from '../payments/vnpay.service';
import { PaymentsService } from '../payments/payments.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  BookingHold,
  BookingHoldStatus,
} from '../inventory/entities/booking-hold.entity';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../payments/entities/payment-transaction.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';

@Injectable()
export class WorkersService {
  private readonly logger = new Logger(WorkersService.name);
  private isProcessingOutbox = false;
  private isProcessingExpiry = false;
  private isProcessingReconciliation = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly mailService: MailService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly vnpayService: VnpayService,
    private readonly paymentsService: PaymentsService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 1. TRANSACTIONAL OUTBOX PROCESSOR
   * Chạy mỗi 3 giây để gửi Email, Socket và tác vụ bất đồng bộ độc lập với DB transaction
   */
  @Interval(3000)
  async processOutboxEvents() {
    if (this.isProcessingOutbox) return;
    this.isProcessingOutbox = true;

    try {
      const events = await this.outboxService.fetchPendingEvents(20);
      for (const event of events) {
        await this.outboxService.markProcessing(event.id);
        try {
          const payload = event.payload;

          switch (event.eventType) {
            case 'mail.payment_success':
              await this.mailService.sendPaymentSuccessEmail(
                payload.contactEmail,
                payload,
              );
              break;

            case 'mail.booking_confirmed':
              await this.mailService.sendBookingConfirmedEmail(
                payload.contactEmail,
                payload,
              );
              break;

            case 'mail.payment_expired':
              await this.mailService.sendPaymentExpiredEmail(
                payload.contactEmail,
                payload,
              );
              break;

            case 'payment.paid':
              this.realtimeGateway.emitPaymentStatusChanged({
                bookingId: payload.bookingId,
                bookingCode: payload.bookingCode,
                status: 'PAID',
                userId: payload.userId,
              });
              this.realtimeGateway.emitBookingReadyForConfirmation({
                bookingId: payload.bookingId,
                bookingCode: payload.bookingCode,
                hotelId: payload.hotelId,
                amount: payload.amount,
                vnpTransactionNo: payload.vnpTransactionNo,
              });
              break;

            case 'payment.failed':
              this.realtimeGateway.emitPaymentStatusChanged({
                bookingId: payload.bookingId,
                bookingCode: payload.bookingCode,
                status: 'FAILED',
                userId: payload.userId,
              });
              break;

            case 'refund.process':
              const refundRes = await this.vnpayService.refund({
                txnRef: payload.txnRef,
                amount: Number(payload.amount),
                transactionNo: payload.transactionNo,
                transactionDate: new Date(payload.transactionDate),
                createBy: 'AutoRefundWorker',
              });

              if (refundRes?.vnp_ResponseCode === '00') {
                await this.dataSource
                  .getRepository(PaymentTransaction)
                  .update(payload.paymentId, {
                    status: PaymentTransactionStatus.REFUNDED,
                    refundedAt: new Date(),
                  });
                this.realtimeGateway.emitRefundStatusChanged({
                  paymentId: payload.paymentId,
                  status: 'REFUNDED',
                  amount: payload.amount,
                });
              } else {
                throw new Error(
                  `VNPay refund failed with response code: ${refundRes?.vnp_ResponseCode}`,
                );
              }
              break;

            default:
              this.logger.debug(
                `[Outbox] Bỏ qua event type không xử lý: ${event.eventType}`,
              );
          }

          await this.outboxService.markCompleted(event.id);
        } catch (err: any) {
          this.logger.error(
            `[Outbox] Xử lý event ${event.id} (${event.eventType}) thất bại: ${err.message}`,
          );
          await this.outboxService.markFailed(
            event.id,
            err.message,
            event.retryCount,
            event.maxRetries,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`[Outbox Worker] Lỗi poll outbox: ${err.message}`);
    } finally {
      this.isProcessingOutbox = false;
    }
  }

  /**
   * 2. EXPIRATION & HOLD SWEEPER
   * Chạy mỗi 10 giây để kiểm tra các hold đã hết hạn (Section 27 & 29)
   * Trước khi giải phóng phòng, BẮT BUỘC gọi QueryDr với VNPay để tránh release nhầm đơn khách đã trả tiền!
   */
  @Interval(10000)
  async sweepExpiredHolds() {
    if (this.isProcessingExpiry) return;
    this.isProcessingExpiry = true;

    try {
      const now = new Date();
      const expiredHolds = await this.dataSource
        .getRepository(BookingHold)
        .find({
          where: {
            status: BookingHoldStatus.HELD,
            holdExpiresAt: LessThanOrEqual(now),
          },
          take: 10,
        });

      for (const hold of expiredHolds) {
        await this.handleExpiredHold(hold);
      }
    } catch (err: any) {
      this.logger.error(`[Expiry Sweeper] Lỗi quét hold: ${err.message}`);
    } finally {
      this.isProcessingExpiry = false;
    }
  }

  private async handleExpiredHold(hold: BookingHold) {
    const bookingId = hold.bookingId;

    // Tìm payment transaction đang PENDING liên quan
    const payment = await this.dataSource
      .getRepository(PaymentTransaction)
      .findOne({
        where: { bookingId, status: PaymentTransactionStatus.PENDING },
        order: { attemptNo: 'DESC' },
      });

    // Nếu có payment PENDING: BẮT BUỘC QueryDr để kiểm tra trạng thái thật tại VNPay
    if (payment) {
      try {
        const qdrResult = await this.vnpayService.queryDr({
          txnRef: payment.txnRef,
          transactionDate: payment.createdAt,
        });

        // Nếu VNPay xác nhận đã thanh toán thành công (00) -> Finalize payment ngay!
        if (
          qdrResult?.vnp_ResponseCode === '00' &&
          qdrResult?.vnp_TransactionStatus === '00'
        ) {
          this.logger.log(
            `[Expiry Sweeper] Khách hàng đã thanh toán thành công trước khi hết hạn cho ${payment.txnRef}. Tiến hành finalize!`,
          );
          await this.paymentsService.processVnpayIpn({
            vnp_TxnRef: payment.txnRef,
            vnp_Amount: Number(payment.amount) * 100,
            vnp_ResponseCode: '00',
            vnp_TransactionStatus: '00',
            vnp_TransactionNo: qdrResult.vnp_TransactionNo || 'EXPIRY_RESOLVED',
            vnp_PayDate: qdrResult.vnp_PayDate,
            vnp_BankCode: qdrResult.vnp_BankCode,
            vnp_CardType: qdrResult.vnp_CardType,
            vnp_SecureHash: 'INTERNAL_QUERYDR_VALIDATED',
          });
          return;
        }
      } catch (err: any) {
        this.logger.warn(
          `[Expiry Sweeper] QueryDr thất bại cho ${payment.txnRef}: ${err.message}. Tạm dừng release để đối soát lại lần sau.`,
        );
        return;
      }
    }

    // Nếu QueryDr xác nhận chưa trả tiền hoặc không có payment -> Release Hold an toàn
    await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Release hold
      await this.inventoryService.releaseHold(
        bookingId,
        'Hết thời hạn thanh toán 15 phút (Hard Expiry)',
        manager,
      );

      // 2. Mark payment EXPIRED nếu có
      if (payment) {
        payment.status = PaymentTransactionStatus.EXPIRED;
        payment.expiredAt = new Date();
        await manager.getRepository(PaymentTransaction).save(payment);
      }

      // 3. Mark booking PAYMENT_EXPIRED
      const booking = await manager.getRepository(Booking).findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });

      if (booking && booking.status === BookingStatus.PAYMENT_PENDING) {
        booking.status = BookingStatus.PAYMENT_EXPIRED;
        await manager.getRepository(Booking).save(booking);

        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: booking.id,
            oldStatus: BookingStatus.PAYMENT_PENDING,
            newStatus: BookingStatus.PAYMENT_EXPIRED,
            changedBy: booking.userId || '1',
            note: 'Hết thời hạn thanh toán phiên checkout (Worker)',
          }),
        );

        // Phát realtime event hết hạn
        this.realtimeGateway.emitBookingPaymentExpired({
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          userId: booking.userId,
          hotelId: booking.hotelId,
        });

        // Đưa email thông báo hết hạn vào outbox
        await this.outboxService.addEvent(
          manager,
          'mail.payment_expired',
          'Booking',
          booking.id,
          {
            bookingCode: booking.bookingCode,
            contactEmail: booking.contactEmail,
            contactName: booking.contactName,
          },
        );
      }
    });

    this.logger.log(
      `[Expiry Sweeper] Đã release hold và cập nhật PAYMENT_EXPIRED cho booking ${bookingId}.`,
    );
  }

  /**
   * 3. PERIODIC RECONCILIATION SWEEPER
   * Chạy mỗi 1 phút để đối soát các giao dịch PENDING quá 5 phút chưa nhận được IPN (Section 34)
   */
  @Interval(60000)
  async reconcilePendingPayments() {
    if (this.isProcessingReconciliation) return;
    this.isProcessingReconciliation = true;

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const pendingPayments = await this.dataSource
        .getRepository(PaymentTransaction)
        .find({
          where: {
            status: PaymentTransactionStatus.PENDING,
            createdAt: LessThanOrEqual(fiveMinutesAgo),
          },
          take: 10,
        });

      for (const p of pendingPayments) {
        this.logger.log(`[Reconciliation Worker] Đang đối soát giao dịch ${p.txnRef}...`);
        await this.paymentsService.reconcilePayment(p.bookingId);
      }
    } catch (err: any) {
      this.logger.error(`[Reconciliation Worker] Lỗi: ${err.message}`);
    } finally {
      this.isProcessingReconciliation = false;
    }
  }
}
