import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingPresenceService } from './booking-presence.service';

@Injectable()
export class PresenceSchedulerService {
  private readonly logger = new Logger(PresenceSchedulerService.name);
  private isProcessing = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly presenceService: BookingPresenceService,
  ) {}

  /**
   * Quét định kỳ mỗi 5 phút (300.000 ms) để:
   *  1. Tự động chuyển NO_SHOW cho các đơn quá hạn ân hạn (mặc định 6 giờ) mà khách chưa đến.
   *  2. Tự động đóng CLOSED_NO_SHOW cho các đơn No-Show đã qua thời điểm kết thúc kỳ lưu trú (checkOutAt).
   */
  @Interval(300_000)
  async handlePresenceCron(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      await this.processEligibleNoShows();
      await this.processExpiredNoShows();
      await this.processOverdueUnmarkedArrivals();
    } catch (error: any) {
      this.logger.error(`Error in PresenceSchedulerService: ${error?.message}`, error?.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Quét và xử lý đánh dấu No-Show cho các đơn quá hạn ân hạn
   */
  private async processEligibleNoShows(): Promise<void> {
    const now = new Date();

    // Tìm các đơn CONFIRMED hoặc PENDING, chưa có actual_check_in_at, và check_in_at đã qua ít nhất 360 phút
    // Chỉ lấy tối đa 50 đơn mỗi chu kỳ để tránh quá tải transaction
    const candidateBookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.PENDING],
      })
      .andWhere('b.actualCheckInAt IS NULL')
      .andWhere('b.checkOutAt > :now', { now })
      .orderBy('b.checkInAt', 'ASC')
      .take(50)
      .getMany();

    for (const booking of candidateBookings) {
      const graceMinutes = booking.noShowGraceMinutes ?? 360;
      const checkInTime = new Date(booking.checkInAt).getTime();
      const thresholdTime = checkInTime + graceMinutes * 60 * 1000;

      if (now.getTime() >= thresholdTime) {
        try {
          await this.presenceService.markNoShowIfEligible(booking.id);
        } catch (err: any) {
          this.logger.warn(
            `Failed to mark No-Show for booking #${booking.bookingCode}: ${err?.message}`,
          );
        }
      }
    }
  }

  /**
   * Quét và xử lý các đơn quá hạn trả phòng mà chưa từng nhận phòng và chưa được đánh dấu No-Show (P1-47)
   */
  private async processOverdueUnmarkedArrivals(): Promise<void> {
    const now = new Date();

    const overdueBookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.PENDING],
      })
      .andWhere('b.actualCheckInAt IS NULL')
      .andWhere('b.checkOutAt <= :now', { now })
      .orderBy('b.checkOutAt', 'ASC')
      .take(50)
      .getMany();

    for (const booking of overdueBookings) {
      try {
        await this.presenceService.reconcileOverdueNeverCheckedIn(booking.id);
      } catch (err: any) {
        this.logger.warn(
          `Failed to reconcile overdue arrival for booking #${booking.bookingCode}: ${err?.message}`,
        );
      }
    }
  }

  /**
   * Quét và đóng các đơn No-Show đã hết hạn kỳ lưu trú (now >= checkOutAt)
   */
  private async processExpiredNoShows(): Promise<void> {
    const now = new Date();

    const expiredCandidates = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.status = :noShow', { noShow: BookingStatus.NO_SHOW })
      .andWhere('b.checkOutAt <= :now', { now })
      .orderBy('b.checkOutAt', 'ASC')
      .take(50)
      .getMany();

    for (const booking of expiredCandidates) {
      try {
        await this.presenceService.closeExpiredNoShow(booking.id);
      } catch (err: any) {
        this.logger.warn(
          `Failed to close expired No-Show for booking #${booking.bookingCode}: ${err?.message}`,
        );
      }
    }
  }
}
