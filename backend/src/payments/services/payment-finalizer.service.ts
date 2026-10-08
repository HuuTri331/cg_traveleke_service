import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { Booking, BookingStatus } from '../../bookings/entities/booking.entity';
import { BookingStatusLog } from '../../bookings/entities/booking-status-log.entity';
import { InventoryService } from '../../inventory/inventory.service';
import { OutboxService } from '../../outbox/outbox.service';

@Injectable()
export class PaymentFinalizerService {
  private readonly logger = new Logger(PaymentFinalizerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Finalize thanh toán từ IPN hoặc QueryDr
   * Bao gồm Defense 2: Kiểm tra xem đã có attempt khác của booking này PAID chưa!
   */
  async finalizeSuccess(
    payment: PaymentTransaction,
    booking: Booking,
    details: {
      responseCode: string;
      transactionStatus: string;
      vnpTransactionNo?: string;
      bankCode?: string;
      cardType?: string;
      payDate?: Date | null;
      rawResponse?: any;
    },
    manager: EntityManager,
    autoAssignFn?: (bookingId: string, manager: EntityManager) => Promise<void>,
  ) {
    const paymentRepo = manager.getRepository(PaymentTransaction);

    // ========================================================
    // DEFENSE 2: Double Payment Defense
    // Kiểm tra xem đơn đặt phòng này đã có attempt khác PAID chưa!
    // ========================================================
    const existingPaid = await paymentRepo.findOne({
      where: {
        bookingId: booking.id,
        status: PaymentTransactionStatus.PAID,
      },
    });

    if (existingPaid && existingPaid.id !== payment.id) {
      this.logger.warn(
        `[PaymentFinalizer] Booking ${booking.id} đã có attempt ${existingPaid.txnRef} được thanh toán PAID trước đó. Attempt ${payment.txnRef} là thanh toán trùng thừa (Duplicate Payment). Đánh dấu PAID_REQUIRES_REVIEW và enqueue refund.process.`,
      );

      payment.status = PaymentTransactionStatus.PAID_REQUIRES_REVIEW;
      payment.responseCode = details.responseCode;
      payment.transactionStatus = details.transactionStatus;
      payment.vnpTransactionNo = details.vnpTransactionNo || null;
      payment.bankCode = details.bankCode || null;
      payment.cardType = details.cardType || null;
      payment.payDate = details.payDate || new Date();
      payment.paidAt = new Date();
      payment.rawIpnResponse = details.rawResponse || null;
      await paymentRepo.save(payment);

      // KHÔNG commit inventory lần 2! Enqueue hoàn tiền giao dịch thừa
      await this.outboxService.addEvent(
        manager,
        'refund.process',
        'PaymentTransaction',
        payment.id,
        {
          bookingId: booking.id,
          paymentId: payment.id,
          txnRef: payment.txnRef,
          amount: payment.amount,
          transactionNo: details.vnpTransactionNo,
          transactionDate: details.payDate || new Date(),
          reason: `Duplicate payment charge: already paid via ${existingPaid.txnRef}`,
        },
      );

      return {
        success: false,
        duplicateCharge: true,
        message: 'Duplicate payment detected. Marked for refund.',
      };
    }

    // ========================================================
    // TỒN KHO: Commit hold hoặc Reacquire (nếu Late IPN)
    // ========================================================
    let holdCommitted = await this.inventoryService.commitHold(
      booking.id,
      manager,
    );

    // Nếu hold đã release (Late IPN case)
    if (!holdCommitted) {
      this.logger.warn(
        `[PaymentFinalizer] Hold của booking ${booking.id} không còn ở trạng thái HELD. Thử reacquire...`,
      );
      const reacquireResult = await this.inventoryService.reacquireInventory(
        booking.id,
        manager,
      );

      if (reacquireResult.success) {
        holdCommitted = reacquireResult.hold!;
      } else {
        // Hết phòng: Tuyệt đối không overbook! Đánh dấu PAID_REQUIRES_REVIEW và enqueue hoàn tiền
        this.logger.error(
          `[PaymentFinalizer] Overbooking prevented! Late payment booking ${booking.id} nhưng phòng đã hết. Đánh dấu PAID_REQUIRES_REVIEW & hoàn tiền bồi hoàn.`,
        );

        payment.status = PaymentTransactionStatus.PAID_REQUIRES_REVIEW;
        payment.responseCode = details.responseCode;
        payment.transactionStatus = details.transactionStatus;
        payment.vnpTransactionNo = details.vnpTransactionNo || null;
        payment.bankCode = details.bankCode || null;
        payment.cardType = details.cardType || null;
        payment.payDate = details.payDate || new Date();
        payment.paidAt = new Date();
        payment.rawIpnResponse = details.rawResponse || null;
        await paymentRepo.save(payment);

        booking.status = BookingStatus.PAYMENT_REVIEW;
        await manager.getRepository(Booking).save(booking);

        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: booking.id,
            oldStatus: booking.status,
            newStatus: BookingStatus.PAYMENT_REVIEW,
            changedBy: booking.userId,
            note: 'Thanh toán thành công nhưng hết phòng (Late IPN) - Tự động bồi hoàn hoàn tiền',
          }),
        );

        // Enqueue command refund.process
        await this.outboxService.addEvent(
          manager,
          'refund.process',
          'PaymentTransaction',
          payment.id,
          {
            bookingId: booking.id,
            paymentId: payment.id,
            txnRef: payment.txnRef,
            amount: payment.amount,
            transactionNo: details.vnpTransactionNo,
            transactionDate: details.payDate || new Date(),
            reason: 'Overbooking prevented on late IPN',
          },
        );

        return {
          success: false,
          overbookingPrevented: true,
          message: 'Overbooking prevented. Compensation refund queued.',
        };
      }
    }

    // ========================================================
    // Cập nhật Payment -> PAID
    // ========================================================
    payment.status = PaymentTransactionStatus.PAID;
    payment.responseCode = details.responseCode;
    payment.transactionStatus = details.transactionStatus;
    payment.vnpTransactionNo = details.vnpTransactionNo || null;
    payment.bankCode = details.bankCode || null;
    payment.cardType = details.cardType || null;
    payment.payDate = details.payDate || new Date();
    payment.paidAt = new Date();
    payment.rawIpnResponse = details.rawResponse || null;
    await paymentRepo.save(payment);

    // Cập nhật Booking -> PENDING (Đã thanh toán, chờ khách sạn check-in / confirm)
    const oldStatus = booking.status;
    booking.status = BookingStatus.PENDING;
    await manager.getRepository(Booking).save(booking);

    // Ghi nhật ký trạng thái
    await manager.getRepository(BookingStatusLog).save(
      manager.getRepository(BookingStatusLog).create({
        bookingId: booking.id,
        oldStatus,
        newStatus: BookingStatus.PENDING,
        changedBy: booking.userId,
        note: `Thanh toán VNPay thành công (Mã GD: ${details.vnpTransactionNo || payment.txnRef})`,
      }),
    );

    // Phân công nhân viên ngầm sau khi đã PAID
    if (autoAssignFn) {
      await autoAssignFn(booking.id, manager);
    }

    // Ghi Outbox Events
    await this.outboxService.addEvent(
      manager,
      'payment.paid',
      'Booking',
      booking.id,
      {
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        paymentId: payment.id,
        vnpTransactionNo: details.vnpTransactionNo,
        amount: payment.amount,
        hotelId: booking.hotelId,
        userId: booking.userId,
      },
    );

    await this.outboxService.addEvent(
      manager,
      'mail.payment_success',
      'Booking',
      booking.id,
      {
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        contactEmail: booking.contactEmail,
        contactName: booking.contactName,
        amount: payment.amount,
        vnpTransactionNo: details.vnpTransactionNo,
        paidAt: payment.paidAt,
        checkInAt: booking.checkInAt,
        checkOutAt: booking.checkOutAt,
      },
    );

    return {
      success: true,
      payment,
      booking,
    };
  }
}
