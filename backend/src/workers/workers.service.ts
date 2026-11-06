import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { OutboxService } from '../outbox/outbox.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { VnpayService } from '../payments/vnpay.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundService } from '../payments/services/refund.service';
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
import { GuestWorkService } from '../guest-work/guest-work.service';
import { BookingAssignmentService } from '../booking-assignment/booking-assignment.service';
import { PromotionsService } from '../promotions/promotions.service';
import { BookingPriceQuote } from '../promotions/entities/booking-price-quote.entity';
import { PromotionCampaign } from '../promotions/entities/promotion-campaign.entity';
import {
  PromotionRefundIntent,
  RefundIntentStatus,
} from '../promotions/entities/promotion-refund-intent.entity';

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
    private readonly refundService: RefundService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
    private readonly bookingAssignmentService: BookingAssignmentService,
    private readonly guestWorkService: GuestWorkService,
    private readonly promotionsService: PromotionsService,
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
      const events = await this.outboxService.claimPendingEvents('WorkerInstance-1', 20);
      for (const event of events) {
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

            case 'booking.payment_expired':
              this.realtimeGateway.emitBookingPaymentExpired({
                bookingId: payload.bookingId,
                bookingCode: payload.bookingCode,
                userId: payload.userId,
                hotelId: payload.hotelId,
              });
              break;

            case 'service_request.created':
              await this.guestWorkService.createTaskFromServiceRequest(payload, payload.actor);
              break;

            case 'booking.assignment.requested': {
              const assignRes = await this.bookingAssignmentService.assignOnce(
                payload.bookingId,
                'PAYMENT_PAID',
              );
              // P1-10: Khởi tạo idempotent nhiệm vụ PRE_ARRIVAL_CONTACT sau khi phân công lễ tân
              if (assignRes && (assignRes.success || assignRes.staffUserId)) {
                await this.guestWorkService.ensurePreArrivalTaskForBooking(String(payload.bookingId));
              }
              break;
            }

            case 'promotion.benefit.grant_requested':
            case 'booking.financially_committed':
              await this.promotionsService.grantQuoteBenefitsForPaidBooking(String(payload.bookingId));
              break;

            case 'promotion.retroactive_scan_requested': {
              // P1-21 & P1-22: Sử dụng internal worker context (không giả lập role SYSTEM qua public guard)
              // và quét theo cursor + tiếp nối qua Outbox, không chặn cứng ở 2.500 booking và không bỏ sót failedBookingIds.
              let cursor = String(payload.afterBookingId || '0');
              let batchCount = 0;
              const maxBatchesPerTick = 20;
              const accumulatedFailedIds = new Set<string>(
                Array.isArray(payload.retryFailedBookingIds) ? payload.retryFailedBookingIds.map(String) : [],
              );

              if (accumulatedFailedIds.size > 0) {
                for (const failedId of [...accumulatedFailedIds]) {
                  try {
                    await this.promotionsService.evaluateExistingBookingBenefitsInternal(failedId, {
                      actorId: String(payload.actorId || 'SYSTEM_RETRO_WORKER'),
                    });
                    accumulatedFailedIds.delete(failedId);
                  } catch {
                    // Giữ lại để retry ở chu kỳ kế tiếp
                  }
                }
              }

              let hasMore = false;
              while (batchCount < maxBatchesPerTick) {
                batchCount += 1;
                const scanRes = await this.promotionsService.evaluateExistingBookingsForHotelInternal(
                  String(payload.hotelId),
                  50,
                  cursor,
                  { actorId: String(payload.actorId || 'SYSTEM_RETRO_WORKER') },
                );
                for (const fid of scanRes.failedBookingIds || []) {
                  accumulatedFailedIds.add(String(fid));
                }
                if (!scanRes.hasMore || !scanRes.nextCursor || scanRes.nextCursor === cursor) {
                  hasMore = false;
                  break;
                }
                cursor = scanRes.nextCursor;
                hasMore = true;
              }

              if ((hasMore || accumulatedFailedIds.size > 0) && Number(payload.continuationAttempt || 0) < 50) {
                await this.outboxService.addEvent(
                  this.dataSource.manager,
                  'promotion.retroactive_scan_requested',
                  'Hotel',
                  String(payload.hotelId),
                  {
                    ...payload,
                    afterBookingId: hasMore ? cursor : '999999999999',
                    retryFailedBookingIds: [...accumulatedFailedIds],
                    continuationAttempt: Number(payload.continuationAttempt || 0) + 1,
                  },
                );
              }
              break;
            }

            case 'promotion.refund.requested':
            case 'refund.requested': {
              // Lỗi 03 & Section II.2.3/2.5: Kiểm tra khóa & trạng thái PromotionRefundIntent trước khi gọi provider
              // để không gửi lệnh hoàn lần 2 khi retry; dùng SYSTEM_REFUND_WORKER thay vì giả lập user ID '1'.
              const intentId = payload.intentId ? String(payload.intentId) : null;
              const requestKey = payload.idempotencyKey || (intentId ? `intent:${intentId}` : `refund:${payload.txnRef}`);
              if (intentId) {
                const preCheck = await this.dataSource.transaction(async (em) => {
                  const intent = await em.findOne(PromotionRefundIntent, {
                    where: { id: intentId },
                    lock: { mode: 'pessimistic_write' },
                  });
                  if (!intent) return { skip: true };
                  if (
                    [
                      RefundIntentStatus.SUCCEEDED,
                      RefundIntentStatus.SANDBOX_SETTLED,
                      RefundIntentStatus.SIMULATED_SUCCEEDED,
                      RefundIntentStatus.MANUAL_TEST_VERIFIED,
                      RefundIntentStatus.SANDBOX_ACCEPTED,
                      RefundIntentStatus.UNKNOWN_RECONCILE,
                    ].includes(intent.status)
                  ) {
                    return { skip: true, intent };
                  }
                  // Nếu đã có providerRef từ lần gọi cổng thành công trước nhưng bước confirm lỗi -> chỉ chạy lại confirm, KHÔNG gọi cổng lần 2!
                  if (intent.providerRef) {
                    return { skipProviderCall: true, intent };
                  }
                  // Lỗi 03 (S-03): Nếu trạng thái đã là PROCESSING:
                  // - Nếu RefundService đã lưu kết quả xác minh của lần gọi trước -> hoàn tất confirm mà không gọi lại provider.
                  // - Ngược lại (crash/timeout khi chưa rõ phản hồi) -> chuyển UNKNOWN_RECONCILE, tuyệt đối không gửi lại lệnh hoàn lần 2!
                  if (intent.status === RefundIntentStatus.PROCESSING) {
                    const cachedOutcome =
                      typeof (this.refundService as any).getVerifiedOutcome === 'function'
                        ? (this.refundService as any).getVerifiedOutcome(requestKey)
                        : null;
                    if (cachedOutcome && cachedOutcome.success) {
                      if (cachedOutcome.providerRef) {
                        intent.providerRef = cachedOutcome.providerRef;
                        await em.save(PromotionRefundIntent, intent);
                      }
                      return { skipProviderCall: true, intent, cachedOutcome };
                    }
                    intent.status = RefundIntentStatus.UNKNOWN_RECONCILE;
                    await em.save(PromotionRefundIntent, intent);
                    return { markUnknownReconcile: true, intent };
                  }
                  intent.status = RefundIntentStatus.PROCESSING;
                  await em.save(PromotionRefundIntent, intent);
                  return { skip: false, intent };
                });

                if (preCheck.skip) {
                  break;
                }
                if (preCheck.markUnknownReconcile && preCheck.intent) {
                  await this.promotionsService.confirmRefundIntentSettlement(
                    { id: 'SYSTEM_REFUND_WORKER', role: 'SYSTEM' },
                    intentId,
                    {
                      settlementOutcome: 'UNKNOWN_RECONCILE',
                    },
                  );
                  break;
                }
                if (preCheck.skipProviderCall && preCheck.intent) {
                  await this.promotionsService.confirmRefundIntentSettlement(
                    { id: 'SYSTEM_REFUND_WORKER', role: 'SYSTEM' },
                    intentId,
                    {
                      providerRef:
                        preCheck.intent.providerRef ||
                        (preCheck as any).cachedOutcome?.providerRef ||
                        undefined,
                      payoutReceiptRef: preCheck.intent.payoutReceiptRef || undefined,
                      settlementOutcome: (preCheck as any).cachedOutcome?.outcomeStatus,
                    },
                  );
                  break;
                }
              }

              const promoRefundRes = await this.refundService.processRefund({
                paymentId: payload.paymentId,
                txnRef: payload.txnRef,
                amount: Number(payload.amount),
                createBy: 'SYSTEM_REFUND_WORKER',
                reason: payload.reason,
                idempotencyKey: payload.idempotencyKey,
                channel: payload.channel,
                payoutReceiptRef: payload.payoutReceiptRef,
                isPromotionPartialRefund: true,
              });

              if (intentId && promoRefundRes.providerRef) {
                await this.dataSource
                  .getRepository(PromotionRefundIntent)
                  .update({ id: intentId }, { providerRef: promoRefundRes.providerRef });
              }

              if (promoRefundRes.outcomeStatus === 'UNKNOWN_RECONCILE') {
                if (intentId) {
                  await this.promotionsService.confirmRefundIntentSettlement(
                    { id: 'SYSTEM_REFUND_WORKER', role: 'SYSTEM' },
                    intentId,
                    {
                      providerRef: promoRefundRes.providerRef,
                      settlementOutcome: 'UNKNOWN_RECONCILE',
                    },
                  );
                }
                break;
              }

              if (promoRefundRes.success && intentId) {
                await this.promotionsService.confirmRefundIntentSettlement(
                  { id: 'SYSTEM_REFUND_WORKER', role: 'SYSTEM' },
                  intentId,
                  {
                    providerRef: promoRefundRes.providerRef,
                    payoutReceiptRef: payload.payoutReceiptRef,
                    settlementOutcome: promoRefundRes.outcomeStatus,
                  },
                );
              } else if (!promoRefundRes.success) {
                if (intentId) {
                  await this.promotionsService.confirmRefundIntentSettlement(
                    { id: 'SYSTEM_REFUND_WORKER', role: 'SYSTEM' },
                    intentId,
                    {
                      settlementOutcome: 'FAILED',
                    },
                  );
                }
                throw new Error(`Promotion refund failed: ${promoRefundRes.error || 'Unknown error'}`);
              }
              break;
            }

            case 'refund.process': {
              const refundRes = await this.refundService.processRefund({
                paymentId: payload.paymentId,
                txnRef: payload.txnRef,
                amount: Number(payload.amount),
                transactionNo: payload.transactionNo,
                transactionDate: payload.transactionDate,
                createBy: 'SYSTEM_REFUND_WORKER',
                reason: payload.reason,
                idempotencyKey: payload.idempotencyKey || `cancel:${payload.requestId || payload.txnRef}`,
              });

              if (refundRes.success) {
                this.realtimeGateway.emitRefundStatusChanged({
                  paymentId: payload.paymentId,
                  status: 'REFUNDED',
                  amount: payload.amount,
                });
              } else if (refundRes.outcomeStatus === 'UNKNOWN_RECONCILE') {
                this.logger.warn(
                  `[Worker] Giao dịch hoàn hủy đơn ${payload.txnRef} ở trạng thái UNKNOWN_RECONCILE — dừng tự động gửi lại để tránh hoàn trùng.`,
                );
              } else {
                throw new Error(
                  `VNPay refund failed: ${refundRes.error || 'Unknown error'}`,
                );
              }
              break;
            }

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

    // Nếu có payment PENDING: BẮT BUỘC đối soát qua PaymentReconciliationService trước khi release
    if (payment) {
      try {
        this.logger.log(
          `[Expiry Sweeper] Hold hết hạn nhưng phát hiện payment PENDING ${payment.txnRef}. Gọi reconcilePayment để đối soát với VNPay...`,
        );
        const reconcileResult = await this.paymentsService.reconcilePayment(bookingId);

        if (
          reconcileResult?.status === PaymentTransactionStatus.PAID ||
          reconcileResult?.status === PaymentTransactionStatus.PAID_REQUIRES_REVIEW
        ) {
          this.logger.log(
            `[Expiry Sweeper] Khách hàng đã thanh toán thành công cho ${payment.txnRef} (Status: ${reconcileResult.status}). Giữ booking, không release!`,
          );
          return;
        }
      } catch (err: any) {
        this.logger.warn(
          `[Expiry Sweeper] Đối soát thất bại cho ${payment.txnRef}: ${err.message}. Tạm dừng release để đối soát lại chu kỳ sau.`,
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

        // PP-P1-03: Giải phóng ngân sách khuyến mãi đã giữ chỗ (budgetReserved) khi phiên thanh toán hết hạn
        try {
          const quoteRepo = manager.getRepository(BookingPriceQuote);
          const campRepo = manager.getRepository(PromotionCampaign);
          const quote = await quoteRepo.findOne({ where: { bookingId: booking.id, status: 'CONFIRMED' } });
          if (quote) {
            quote.status = 'EXPIRED';
            await quoteRepo.save(quote);
            for (const applied of quote.appliedCampaigns || []) {
              const camp = await campRepo.findOne({
                where: { id: applied.campaignId },
                lock: { mode: 'pessimistic_write' },
              });
              if (camp) {
                const disc = Math.max(0, Math.round(Number(applied.discountAmount || 0)));
                camp.budgetReserved = Math.max(0, Number(camp.budgetReserved || 0) - disc);
                camp.redemptionsCount = Math.max(0, Number(camp.redemptionsCount || 0) - 1);
                await campRepo.save(camp);
              }
            }
          }
        } catch {}

        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: booking.id,
            oldStatus: BookingStatus.PAYMENT_PENDING,
            newStatus: BookingStatus.PAYMENT_EXPIRED,
            changedBy: booking.userId || '1',
            note: 'Hết thời hạn thanh toán phiên checkout (Worker)',
          }),
        );

        // Đưa realtime event hết hạn vào outbox (được emit bởi outbox dispatcher sau khi commit)
        await this.outboxService.addEvent(
          manager,
          'booking.payment_expired',
          'Booking',
          booking.id,
          {
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            userId: booking.userId,
            hotelId: booking.hotelId,
          },
        );

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

  /**
   * 4. ĐỊNH KỲ RÀ SOÁT VÀ PHÂN CÔNG BÙ CHO CÁC BOOKING PAID CHƯA ĐƯỢC GIAO (Mỗi 5 phút)
   */
  @Interval(300000)
  async handlePeriodicAssignmentRepair() {
    try {
      await this.bookingAssignmentService.repairUnassignedPaidBookings();
    } catch (err: any) {
      this.logger.error(`[Worker] Lỗi rà soát phân công bù: ${err.message}`);
    }
  }
}

