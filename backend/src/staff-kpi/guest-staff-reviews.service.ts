import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskStatus, WorkTaskType } from '../guest-work/entities/guest-work-task.entity';
import { SubmitStaffReviewDto, UpdateStaffReviewDto } from './dto/kpi.dto';
import { GuestStaffReviewRevision } from './entities/guest-staff-review-revision.entity';
import { GuestStaffReview, ReviewStage } from './entities/guest-staff-review.entity';

export interface EligibleReviewTarget {
  staffUserId: string;
  stage: ReviewStage;
  alreadyReviewed: boolean;
  reviewId?: string;
  currentStars?: number;
}

@Injectable()
export class GuestStaffReviewsService {
  constructor(
    @InjectRepository(GuestStaffReview) private readonly reviewRepo: Repository<GuestStaffReview>,
    @InjectRepository(GuestStaffReviewRevision) private readonly revisionRepo: Repository<GuestStaffReviewRevision>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(GuestWorkEvent) private readonly workEventRepo: Repository<GuestWorkEvent>,
    @InjectRepository(GuestWorkTask) private readonly taskRepo: Repository<GuestWorkTask>,
  ) {}

  async getEligibleReviewTargets(bookingId: string, customerUserId: string): Promise<EligibleReviewTarget[]> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    if (String(booking.userId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể đánh giá nhân viên cho đơn đặt phòng của chính mình');
    }
    const targets = new Map<string, EligibleReviewTarget>();
    const add = (staffUserId: string | null | undefined, stage: ReviewStage) => {
      if (staffUserId) targets.set(`${staffUserId}_${stage}`, { staffUserId: String(staffUserId), stage, alreadyReviewed: false });
    };
    const [events, tasks] = await Promise.all([
      this.workEventRepo.find({ where: { bookingId } }),
      this.taskRepo.find({ where: { bookingId } }),
    ]);
    const taskById = new Map(tasks.map((t) => [String(t.id), t]));
    const checkInTime = booking.actualCheckInAt ? new Date(booking.actualCheckInAt) : new Date(booking.checkInAt);

    // Pre-arrival: never infer from booking.handledBy alone; require verified pre-stay interaction.
    for (const evt of events) {
      if (!evt.actorStaffId || evt.evidenceType === WorkEvidenceType.SELF_REPORTED) continue;
      const task = taskById.get(String(evt.taskId));
      if (evt.evidenceType === WorkEvidenceType.MESSAGE && new Date(evt.occurredAt) <= checkInTime) {
        add(evt.actorStaffId, ReviewStage.PRE_ARRIVAL);
      } else if (task?.type === WorkTaskType.PRE_ARRIVAL_CONTACT &&
        evt.eventType === WorkEventType.TASK_COMPLETED &&
        [WorkTaskStatus.COMPLETED, WorkTaskStatus.VERIFIED].includes(task.status)) {
        add(evt.actorStaffId, ReviewStage.PRE_ARRIVAL);
      } else if (task && [WorkTaskType.SERVICE_REQUEST, WorkTaskType.COMPLAINT_HANDLE].includes(task.type) &&
        evt.eventType === WorkEventType.TASK_COMPLETED &&
        [WorkTaskStatus.COMPLETED, WorkTaskStatus.VERIFIED].includes(task.status)) {
        add(evt.actorStaffId, ReviewStage.IN_STAY);
      }
    }
    if (booking.actualCheckInAt && booking.checkInConfirmedBy) add(booking.checkInConfirmedBy, ReviewStage.CHECK_IN);
    if (booking.actualCheckOutAt && booking.checkOutConfirmedBy) add(booking.checkOutConfirmedBy, ReviewStage.CHECK_OUT);

    const existing = await this.reviewRepo.find({ where: { bookingId, reviewerUserId: customerUserId } });
    for (const rev of existing) {
      const target = targets.get(`${rev.staffUserId}_${rev.stage}`);
      if (target) Object.assign(target, { alreadyReviewed: true, reviewId: rev.id, currentStars: rev.stars });
    }
    return [...targets.values()];
  }

  async submitReview(customerUserId: string, dto: SubmitStaffReviewDto): Promise<GuestStaffReview> {
    const booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);
    if (String(booking.userId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể đánh giá nhân viên cho đơn đặt phòng của mình');
    }
    const eligibleList = await this.getEligibleReviewTargets(dto.bookingId, customerUserId);
    if (!eligibleList.some((t) => String(t.staffUserId) === String(dto.staffUserId) && t.stage === dto.stage)) {
      throw new BadRequestException(`Nhân viên #${dto.staffUserId} chưa có chứng cứ phục vụ ở giai đoạn ${dto.stage} cho đơn này`);
    }
    const existing = await this.reviewRepo.findOne({
      where: { bookingId: dto.bookingId, staffUserId: dto.staffUserId, stage: dto.stage, reviewerUserId: customerUserId },
    });
    if (existing) throw new ConflictException(`Bạn đã gửi đánh giá cho nhân sự này ở giai đoạn ${dto.stage}.`);
    const savedReview = await this.reviewRepo.save(this.reviewRepo.create({
      bookingId: dto.bookingId, hotelId: booking.hotelId, reviewerUserId: customerUserId,
      staffUserId: dto.staffUserId, stage: dto.stage, stars: dto.stars,
      comment: dto.comment || null, status: 'ACTIVE', currentRevision: 1,
    }));
    await this.revisionRepo.save(this.revisionRepo.create({
      reviewId: savedReview.id, version: 1, oldStars: dto.stars, newStars: dto.stars,
      oldComment: null, newComment: dto.comment || null, changedBy: customerUserId,
      reason: 'Đánh giá ban đầu của khách hàng',
    }));
    return savedReview;
  }

  async updateReview(reviewId: string, customerUserId: string, dto: UpdateStaffReviewDto): Promise<GuestStaffReview> {
    const review = await this.reviewRepo.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException(`Không tìm thấy đánh giá #${reviewId}`);
    if (String(review.reviewerUserId) !== String(customerUserId)) {
      throw new ForbiddenException('Bạn chỉ có thể chỉnh sửa đánh giá do chính mình tạo');
    }
    const oldStars = review.stars;
    const oldComment = review.comment;
    review.stars = dto.stars;
    review.comment = dto.comment || null;
    review.currentRevision += 1;
    const updatedReview = await this.reviewRepo.save(review);
    await this.revisionRepo.save(this.revisionRepo.create({
      reviewId: review.id, version: review.currentRevision, oldStars, newStars: dto.stars,
      oldComment, newComment: dto.comment || null, changedBy: customerUserId,
      reason: dto.reason || 'Khách hàng cập nhật đánh giá',
    }));
    return updatedReview;
  }
}
