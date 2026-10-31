import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestStaffReview } from './entities/guest-staff-review.entity';
import { GuestStaffReviewRevision } from './entities/guest-staff-review-revision.entity';
import { StaffKpiPolicy } from './entities/staff-kpi-policy.entity';
import { StaffKpiPeriodScore } from './entities/staff-kpi-period-score.entity';
import { StaffKpiMetricScore } from './entities/staff-kpi-metric-score.entity';
import { StaffKpiAdjustment } from './entities/staff-kpi-adjustment.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkEvent } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { BookingPresenceEvent } from '../booking-presence/entities/booking-presence-event.entity';
import { KpiCalculationService } from './kpi-calculation.service';
import { GuestStaffReviewsService } from './guest-staff-reviews.service';
import { StaffKpiController } from './staff-kpi.controller';
import { GuestStaffReviewsController } from './guest-staff-reviews.controller';
import { StaffAvailabilityModule } from '../staff-availability/staff-availability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuestStaffReview,
      GuestStaffReviewRevision,
      StaffKpiPolicy,
      StaffKpiPeriodScore,
      StaffKpiMetricScore,
      StaffKpiAdjustment,
      Booking,
      GuestWorkEvent,
      GuestWorkTask,
      BookingPresenceEvent,
    ]),
    StaffAvailabilityModule,
  ],
  controllers: [StaffKpiController, GuestStaffReviewsController],
  providers: [KpiCalculationService, GuestStaffReviewsService],
  exports: [KpiCalculationService, GuestStaffReviewsService],
})
export class StaffKpiModule {}

