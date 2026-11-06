import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';

export interface CreateStayReviewDto {
  bookingId: string;
  overallRating: number;
  cleanlinessRating: number;
  roomQualityRating: number;
  serviceRating: number;
  locationRating: number;
  comment?: string;
}

@Injectable()
export class StayReviewsService {
  private readonly reviewsByBookingUser = new Map<string, any>();

  constructor(private readonly dataSource: DataSource) {}

  private maskPiiInComment(comment?: string): string | null {
    if (!comment) return null;
    return comment
      .replace(/\b\d{9,12}\b/g, '[REDACTED_PHONE_OR_ID]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  }

  /**
   * Submits a verified stay review (IMP-23 / GAP-23):
   * - Requires `booking.status === COMPLETED` and `actualCheckInAt != null` (blocks NO_SHOW from reviewing).
   * - Low rating (<= 2) opens a `COMPLAINT_HANDLE` feedback case for manager verification without
   *   automatically deducting individual staff KPI points before investigation!
   */
  async submitStayReview(
    dto: CreateStayReviewDto,
    actor: { id: string; role: string },
  ) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(dto.bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${dto.bookingId} không tồn tại.`);

    if (String(booking.userId) !== String(actor.id)) {
      throw new ForbiddenException('Chỉ khách đặt phòng hoặc khách chính đã xác minh mới được đánh giá kỳ lưu trú.');
    }

    if (booking.status !== BookingStatus.COMPLETED || !(booking as any).actualCheckInAt) {
      throw new ConflictException(
        'STAY_REVIEW_REQUIRES_COMPLETED_STAY: Chỉ những kỳ lưu trú thực tế đã hoàn tất (COMPLETED có actualCheckInAt) mới được gửi đánh giá (chặn NO_SHOW/CANCELLED).',
      );
    }

    for (const r of [
      dto.overallRating,
      dto.cleanlinessRating,
      dto.roomQualityRating,
      dto.serviceRating,
      dto.locationRating,
    ]) {
      if (Number(r) < 1 || Number(r) > 5) {
        throw new BadRequestException('Điểm đánh giá từng hạng mục phải nằm trong khoảng 1..5 sao.');
      }
    }

    const dedupKey = `${booking.id}:${actor.id}`;
    if (this.reviewsByBookingUser.has(dedupKey)) {
      throw new ConflictException('DUPLICATE_STAY_REVIEW: Bạn đã gửi đánh giá cho kỳ lưu trú này.');
    }

    const opensComplaintCase = Number(dto.overallRating) <= 2;
    const record = {
      bookingId: String(booking.id),
      hotelId: String(booking.hotelId),
      reviewerUserId: String(actor.id),
      overallRating: Number(dto.overallRating),
      cleanlinessRating: Number(dto.cleanlinessRating),
      roomQualityRating: Number(dto.roomQualityRating),
      serviceRating: Number(dto.serviceRating),
      locationRating: Number(dto.locationRating),
      comment: this.maskPiiInComment(dto.comment),
      status: 'PUBLISHED',
      feedbackCaseType: opensComplaintCase ? 'COMPLAINT_HANDLE' : null,
      feedbackCaseStatus: opensComplaintCase ? 'OPEN_PENDING_INVESTIGATION' : null,
      autoKpiPenaltyApplied: false,
      createdAt: new Date(),
    };

    this.reviewsByBookingUser.set(dedupKey, record);
    return record;
  }
}
