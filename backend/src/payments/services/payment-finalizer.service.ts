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
    const bookingRepo = manager.getRepository(Booking);

    // Khóa pessimistic_write cả PaymentTransaction và Booking để Finalizer là canonical locking authority duy nhất
    const lockedPayment = await paymentRepo.findOne({
      where: { id: payment.id },
      lock: { mode: 'pessimistic_write' },
    });
    const lockedBooking = await bookingRepo.findOne({
      where: { id: booking.id },
      lock: { mode: 'pessimistic_write' },
    });

    const targetPayment = lockedPayment || payment;
    const targetBooking = lockedBooking || booking;

    // Idempotent: Nếu transaction này đã là PAID thì trả về luôn không xử lý lại
    if (targetPayment.status === PaymentTransactionStatus.PAID) {
      return {
        success: true,
        paymentStatus: PaymentTransactionStatus.PAID,
        bookingStatus: targetBooking.status,
        outcome: 'ALREADY_PAID',
        payment: targetPayment,
        booking: targetBooking,
      };
    }

    // ========================================================
    // DEFENSE 2: Double Payment Defense
    // Kiểm tra xem đơn đặt phòng này đã có attempt khác PAID chưa!
    // ========================================================
    const existingPaid = await paymentRepo.findOne({
      where: {
        bookingId: targetBooking.id,
        status: PaymentTransactionStatus.PAID,
      },
    });

    if (existingPaid && existingPaid.id !== targetPayment.id) {
      this.logger.warn(
        `[PaymentFinalizer] Booking ${targetBooking.id} đã có attempt ${existingPaid.txnRef} được thanh toán PAID trước đó. Attempt ${targetPayment.txnRef} là thanh toán trùng thừa (Duplicate Payment). Đánh dấu PAID_REQUIRES_REVIEW và enqueue refund.process.`,
      );

      targetPayment.status = PaymentTransactionStatus.PAID_REQUIRES_REVIEW;
      targetPayment.responseCode = details.responseCode;
      targetPayment.transactionStatus = details.transactionStatus;
      targetPayment.vnpTransactionNo = details.vnpTransactionNo || null;
      targetPayment.bankCode = details.bankCode || null;
      targetPayment.cardType = details.cardType || null;
      targetPayment.payDate = details.payDate || new Date();
      targetPayment.paidAt = new Date();
      targetPayment.rawIpnResponse = details.rawResponse || null;
      await paymentRepo.save(targetPayment);

      // KHÔNG commit inventory lần 2! Enqueue hoàn tiền giao dịch thừa
      await this.outboxService.addEvent(
        manager,
        'refund.process',
        'PaymentTransaction',
        targetPayment.id,
        {
          bookingId: targetBooking.id,
          paymentId: targetPayment.id,
          txnRef: targetPayment.txnRef,
          amount: targetPayment.amount,
          transactionNo: details.vnpTransactionNo,
          transactionDate: details.payDate || new Date(),
          reason: `Duplicate payment charge: already paid via ${existingPaid.txnRef}`,
        },
      );

      return {
        success: false,
        paymentStatus: PaymentTransactionStatus.PAID_REQUIRES_REVIEW,
        bookingStatus: targetBooking.status,
        outcome: 'DUPLICATE_CHARGE',
        duplicateCharge: true,
        message: 'Duplicate payment detected. Marked for refund.',
      };
    }

    // ========================================================
    // TỒN KHO: Commit hold hoặc Reacquire (nếu Late IPN)
    // ========================================================
    let holdCommitted = await this.inventoryService.commitHold(
      targetBooking.id,
      manager,
    );

    // Nếu hold đã release (Late IPN case)
    if (!holdCommitted) {
      this.logger.warn(
        `[PaymentFinalizer] Hold của booking ${targetBooking.id} không còn ở trạng thái HELD. Thử reacquire...`,
      );
      const reacquireResult = await this.inventoryService.reacquireInventory(
        targetBooking.id,
        manager,
      );

      if (reacquireResult.success) {
        holdCommitted = reacquireResult.hold!;
      } else {
        // Hết phòng: Tuyệt đối không overbook! Đánh dấu PAID_REQUIRES_REVIEW và enqueue hoàn tiền
        this.logger.error(
          `[PaymentFinalizer] Overbooking prevented! Late payment booking ${targetBooking.id} nhưng phòng đã hết. Đánh dấu PAID_REQUIRES_REVIEW & hoàn tiền bồi hoàn.`,
        );

        targetPayment.status = PaymentTransactionStatus.PAID_REQUIRES_REVIEW;
        targetPayment.responseCode = details.responseCode;
        targetPayment.transactionStatus = details.transactionStatus;
        targetPayment.vnpTransactionNo = details.vnpTransactionNo || null;
        targetPayment.bankCode = details.bankCode || null;
        targetPayment.cardType = details.cardType || null;
        targetPayment.payDate = details.payDate || new Date();
        targetPayment.paidAt = new Date();
        targetPayment.rawIpnResponse = details.rawResponse || null;
        await paymentRepo.save(targetPayment);

        const oldStatus = targetBooking.status;
        targetBooking.status = BookingStatus.PAYMENT_REVIEW;
        await bookingRepo.save(targetBooking);

        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: targetBooking.id,
            oldStatus,
            newStatus: BookingStatus.PAYMENT_REVIEW,
            changedBy: targetBooking.userId,
            note: 'Thanh toán thành công nhưng hết phòng (Late IPN) - Tự động bồi hoàn hoàn tiền',
          }),
        );

        // Enqueue command refund.process
        await this.outboxService.addEvent(
          manager,
          'refund.process',
          'PaymentTransaction',
          targetPayment.id,
          {
            bookingId: targetBooking.id,
            paymentId: targetPayment.id,
            txnRef: targetPayment.txnRef,
            amount: targetPayment.amount,
            transactionNo: details.vnpTransactionNo,
            transactionDate: details.payDate || new Date(),
            reason: 'Overbooking prevented on late IPN',
          },
        );

        return {
          success: false,
          paymentStatus: PaymentTransactionStatus.PAID_REQUIRES_REVIEW,
          bookingStatus: BookingStatus.PAYMENT_REVIEW,
          outcome: 'OVERBOOKING_PREVENTED',
          overbookingPrevented: true,
          message: 'Overbooking prevented. Compensation refund queued.',
        };
      }
    }

    // ========================================================
    // Cập nhật Payment -> PAID
    // ========================================================
    targetPayment.status = PaymentTransactionStatus.PAID;
    targetPayment.responseCode = details.responseCode;
    targetPayment.transactionStatus = details.transactionStatus;
    targetPayment.vnpTransactionNo = details.vnpTransactionNo || null;
    targetPayment.bankCode = details.bankCode || null;
    targetPayment.cardType = details.cardType || null;
    targetPayment.payDate = details.payDate || new Date();
    targetPayment.paidAt = new Date();
    targetPayment.rawIpnResponse = details.rawResponse || null;
    await paymentRepo.save(targetPayment);

    // Cập nhật Booking -> PENDING (Đã thanh toán, chờ khách sạn check-in / confirm)
    const oldStatus = targetBooking.status;
    targetBooking.status = BookingStatus.PENDING;
    await bookingRepo.save(targetBooking);

    // Ghi nhật ký trạng thái
    await manager.getRepository(BookingStatusLog).save(
      manager.getRepository(BookingStatusLog).create({
        bookingId: targetBooking.id,
        oldStatus,
        newStatus: BookingStatus.PENDING,
        changedBy: targetBooking.userId,
        note: `Thanh toán VNPay thành công (Mã GD: ${details.vnpTransactionNo || targetPayment.txnRef})`,
      }),
    );

    // D1-08: Đã loại bỏ callback autoAssignFn legacy để đảm bảo duy nhất 1 bộ máy phân công công bằng
    // qua sự kiện Outbox 'booking.assignment.requested' -> BookingAssignmentService.assignOnce()

    // Ghi Outbox Events
    await this.outboxService.addEvent(
      manager,
      'payment.paid',
      'Booking',
      targetBooking.id,
      {
        bookingId: targetBooking.id,
        bookingCode: targetBooking.bookingCode,
        paymentId: targetPayment.id,
        vnpTransactionNo: details.vnpTransactionNo,
        amount: targetPayment.amount,
        hotelId: targetBooking.hotelId,
        userId: targetBooking.userId,
      },
    );

    // Kích hoạt phân công lễ tân công bằng bất đồng bộ độc lập (Đợt 1)
    await this.outboxService.addEvent(
      manager,
      'booking.assignment.requested',
      'Booking',
      targetBooking.id,
      {
        bookingId: targetBooking.id,
        hotelId: targetBooking.hotelId,
        causation: 'PAYMENT_PAID',
        occurredAt: new Date(),
      },
    );

    await this.outboxService.addEvent(
      manager,
      'mail.payment_success',
      'Booking',
      targetBooking.id,
      {
        bookingId: targetBooking.id,
        bookingCode: targetBooking.bookingCode,
        contactEmail: targetBooking.contactEmail,
        contactName: targetBooking.contactName,
        amount: targetPayment.amount,
        vnpTransactionNo: details.vnpTransactionNo,
        paidAt: targetPayment.paidAt,
        checkInAt: targetBooking.checkInAt,
        checkOutAt: targetBooking.checkOutAt,
      },
    );

    return {
      success: true,
      paymentStatus: PaymentTransactionStatus.PAID,
      bookingStatus: BookingStatus.PENDING,
      outcome: 'PAID_COMMITTED',
      payment: targetPayment,
      booking: targetBooking,
    };
  }
}
