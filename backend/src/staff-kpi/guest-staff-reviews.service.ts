import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GuestStaffReview,
  ReviewStage,
} from './entities/guest-staff-review.entity';
import { GuestStaffReviewRevision } from './entities/guest-staff-review-revision.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkEvent, WorkEventType } from '../guest-work/entities/guest-work-event.entity';
import { SubmitStaffReviewDto, UpdateStaffReviewDto } from './dto/kpi.dto';

export interface EligibleReviewTarget {
  staffUserId: string;
  stage: ReviewStage;
  alreadyReviewed: boolean;
  reviewId?: string;
  currentStars?: number;
}

@Injectable()
export class GuestStaffReviewsService {
  private readonly logger = new Logger(GuestStaffReviewsService.name);

  constructor(
    @InjectRepository(GuestStaffReview)
    private readonly reviewRepo: Repository<GuestStaffReview>,
    @InjectRepository(GuestStaffReviewRevision)
    private readonly revisionRepo: Repository<GuestStaffReviewRevision>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(GuestWorkEvent)
    private readonly workEventRepo: Repository<GuestWorkEvent>,
  ) {}

  async getEligibleReviewTargets(
    bookingId: string,
    customerUserId: string,
  ): Promise<EligibleReviewTarget[]> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (String(booking.userId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể đánh giá nhân viên cho đơn đặt phòng của chính mình');
    }

    const targets: Map<string, EligibleReviewTarget> = new Map();

    // 1. Giai đoạn PRE_ARRIVAL (D5-05: Ưu tiên nhân sự thực tế đã tương tác/chuẩn bị trước nhận phòng từ workEvents, bảo lưu cả khi đơn đã chuyển giao sang B)
    const allWorkEvents = await this.workEventRepo.find({
      where: { bookingId },
    });
    for (const evt of allWorkEvents) {
      if (
        evt.actorStaffId &&
        (evt.evidenceType === 'MESSAGE' || evt.eventType === WorkEventType.TASK_STARTED)
      ) {
        const key = `${evt.actorStaffId}_${ReviewStage.PRE_ARRIVAL}`;
        targets.set(key, {
          staffUserId: evt.actorStaffId,
          stage: ReviewStage.PRE_ARRIVAL,
          alreadyReviewed: false,
        });
      }
    }
    if (
      booking.handledBy &&
      booking.status !== 'CANCELLED' &&
      booking.status !== 'REJECTED' &&
      booking.status !== 'PAYMENT_PENDING'
    ) {
      const key = `${booking.handledBy}_${ReviewStage.PRE_ARRIVAL}`;
      if (!targets.has(key)) {
        targets.set(key, {
          staffUserId: booking.handledBy,
          stage: ReviewStage.PRE_ARRIVAL,
          alreadyReviewed: false,
        });
      }
    }

    // 2. Giai đoạn CHECK_IN
    if (booking.actualCheckInAt) {
      const staffId = booking.checkInConfirmedBy || booking.handledBy;
      if (staffId) {
        const key = `${staffId}_${ReviewStage.CHECK_IN}`;
        targets.set(key, {
          staffUserId: staffId,
          stage: ReviewStage.CHECK_IN,
          alreadyReviewed: false,
        });
      }
    }

    // 3. Giai đoạn IN_STAY (các nhân sự đã xử lý task dịch vụ)
    const serviceEvents = allWorkEvents.filter(
      (evt) => evt.eventType === WorkEventType.TASK_COMPLETED,
    );
    for (const evt of serviceEvents) {
      if (evt.actorStaffId) {
        const key = `${evt.actorStaffId}_${ReviewStage.IN_STAY}`;
        targets.set(key, {
          staffUserId: evt.actorStaffId,
          stage: ReviewStage.IN_STAY,
          alreadyReviewed: false,
        });
      }
    }

    // 4. Giai đoạn CHECK_OUT
    if (booking.actualCheckOutAt) {
      const staffId = booking.checkOutConfirmedBy || booking.handledBy;
      if (staffId) {
        const key = `${staffId}_${ReviewStage.CHECK_OUT}`;
        targets.set(key, {
          staffUserId: staffId,
          stage: ReviewStage.CHECK_OUT,
          alreadyReviewed: false,
        });
      }
    }

    // Đối chiếu với các review đã gửi
    const existingReviews = await this.reviewRepo.find({
      where: { bookingId, reviewerUserId: customerUserId },
    });
    for (const rev of existingReviews) {
      const key = `${rev.staffUserId}_${rev.stage}`;
      const target = targets.get(key);
      if (target) {
        target.alreadyReviewed = true;
        target.reviewId = rev.id;
        target.currentStars = rev.stars;
      }
    }

    return Array.from(targets.values());
  }

  async submitReview(
    customerUserId: string,
    dto: SubmitStaffReviewDto,
  ): Promise<GuestStaffReview> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    }

    if (String(booking.userId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể đánh giá nhân viên cho đơn đặt phòng của mình');
    }

    // Kiểm tra tính đủ điều kiện
    const eligibleList = await this.getEligibleReviewTargets(dto.bookingId, customerUserId);
    const isEligible = eligibleList.some(
      (t) => String(t.staffUserId) === String(dto.staffUserId) && t.stage === dto.stage,
    );
    if (!isEligible) {
      throw new BadRequestException(
        `Nhân viên #${dto.staffUserId} không thuộc diện được đánh giá ở giai đoạn ${dto.stage} cho đơn này`,
      );
    }

    const existing = await this.reviewRepo.findOne({
      where: {
        bookingId: dto.bookingId,
        staffUserId: dto.staffUserId,
        stage: dto.stage,
        reviewerUserId: customerUserId,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Bạn đã gửi đánh giá cho nhân sự này ở giai đoạn ${dto.stage}. Hãy dùng chức năng chỉnh sửa đánh giá.`,
      );
    }

    const review = this.reviewRepo.create({
      bookingId: dto.bookingId,
      hotelId: booking.hotelId,
      reviewerUserId: customerUserId,
      staffUserId: dto.staffUserId,
      stage: dto.stage,
      stars: dto.stars,
      comment: dto.comment || null,
      status: 'ACTIVE',
      currentRevision: 1,
    });
    const savedReview = await this.reviewRepo.save(review);

    const revision = this.revisionRepo.create({
      reviewId: savedReview.id,
      version: 1,
      oldStars: dto.stars,
      newStars: dto.stars,
      oldComment: null,
      newComment: dto.comment || null,
      changedBy: customerUserId,
      reason: 'Đánh giá ban đầu của khách hàng',
    });
    await this.revisionRepo.save(revision);

    return savedReview;
  }

  async updateReview(
    reviewId: string,
    customerUserId: string,
    dto: UpdateStaffReviewDto,
  ): Promise<GuestStaffReview> {
    const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá #${reviewId}`);
    }

    if (String(review.reviewerUserId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể chỉnh sửa đánh giá do chính mình tạo');
    }

    const oldStars = review.stars;
    const oldComment = review.comment;
    review.stars = dto.stars;
    review.comment = dto.comment || null;
    review.currentRevision += 1;
    const updatedReview = await this.reviewRepo.save(review);

    const revision = this.revisionRepo.create({
      reviewId: review.id,
      version: review.currentRevision,
      oldStars,
      newStars: dto.stars,
      oldComment,
      newComment: dto.comment || null,
      changedBy: customerUserId,
      reason: dto.reason || 'Khách hàng cập nhật đánh giá',
    });
    await this.revisionRepo.save(revision);

    return updatedReview;
  }
}
