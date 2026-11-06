import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingAmendment } from '../booking-amendments/entities/booking-amendment.entity';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { BookingDocument } from '../booking-documents/entities/booking-document.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { FolioService } from '../folio/folio.service';
import { PaymentTransaction, PaymentTransactionStatus } from '../payments/entities/payment-transaction.entity';
import { PrecheckinSubmission } from '../precheckin/entities/precheckin.entity';

@Injectable()
export class MyBookingProjectionService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly folioService?: FolioService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  /**
   * Read-only My Booking 360 projection (IMP-22 / GAP-22).
   * Calculates `allowedActions` server-side and resolves effective executor (B if A handed over).
   */
  async getCustomerBookingOverview(
    bookingId: string,
    actor: { id: string; role: string },
  ) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    if (String(booking.userId) !== String(actor.id) && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền xem thông tin booking của khách hàng khác.');
    }

    const payments = await this.dataSource.getRepository(PaymentTransaction).find({
      where: { bookingId: String(booking.id) },
      order: { createdAt: 'DESC' },
    });
    const hasVerifiedPaid = payments.some((p) => p.status === PaymentTransactionStatus.PAID);
    const hasPaymentReview = payments.some((p) => (p.status as string) === 'PAYMENT_REVIEW');

    let effectiveOperatorId = booking.handledBy ? String(booking.handledBy) : null;
    if (this.coverageService && typeof (this.coverageService as any).resolveEffectiveExecutor === 'function') {
      try {
        const resolved = await (this.coverageService as any).resolveEffectiveExecutor(
          this.dataSource,
          booking.id,
        );
        if (resolved?.effectiveUserId) {
          effectiveOperatorId = String(resolved.effectiveUserId);
        }
      } catch {
        // Keep handledBy
      }
    }

    const [amendments, precheckin, documents, folioSummary] = await Promise.all([
      this.dataSource.getRepository(BookingAmendment).find({ where: { bookingId: String(booking.id) } }),
      this.dataSource.getRepository(PrecheckinSubmission).findOne({ where: { bookingId: String(booking.id) } }),
      this.dataSource.getRepository(BookingDocument).find({ where: { bookingId: String(booking.id) } }),
      this.folioService ? this.folioService.getBookingFolio(booking.id) : Promise.resolve(null),
    ]);

    const isActivePaidStay =
      hasVerifiedPaid &&
      !hasPaymentReview &&
      (booking.status === BookingStatus.PENDING ||
        booking.status === BookingStatus.CONFIRMED ||
        booking.status === BookingStatus.CHECKED_IN);

    const allowedActions = {
      canCancel:
        hasVerifiedPaid &&
        !hasPaymentReview &&
        (booking.status === BookingStatus.PENDING || booking.status === BookingStatus.CONFIRMED),
      canAmend:
        hasVerifiedPaid &&
        !hasPaymentReview &&
        (booking.status === BookingStatus.PENDING || booking.status === BookingStatus.CONFIRMED),
      canRequestService: isActivePaidStay,
      canPrecheckin:
        hasVerifiedPaid &&
        !hasPaymentReview &&
        (booking.status === BookingStatus.PENDING || booking.status === BookingStatus.CONFIRMED),
      canReview:
        booking.status === BookingStatus.COMPLETED && Boolean((booking as any).actualCheckInAt),
      canDownloadDocument: hasVerifiedPaid && documents.length > 0,
    };

    return {
      booking: {
        id: String(booking.id),
        hotelId: String(booking.hotelId),
        status: booking.status,
        paymentState: hasPaymentReview
          ? 'PAYMENT_REVIEW'
          : hasVerifiedPaid
          ? 'PAID'
          : 'PAYMENT_PENDING',
        checkInAt: booking.checkInAt,
        checkOutAt: booking.checkOutAt,
        effectiveOperatorId,
      },
      folio: folioSummary?.folio || null,
      amendments,
      precheckin: precheckin || null,
      documents,
      allowedActions,
    };
  }
}
