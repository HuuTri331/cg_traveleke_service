import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  StaffKpiPeriodScore,
  KpiPeriodStatus,
} from './entities/staff-kpi-period-score.entity';
import { StaffKpiMetricScore } from './entities/staff-kpi-metric-score.entity';
import { StaffKpiAdjustment, AdjustmentStatus } from './entities/staff-kpi-adjustment.entity';
import { GuestStaffReview } from './entities/guest-staff-review.entity';
import { GuestWorkEvent, WorkEventType } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskStatus } from '../guest-work/entities/guest-work-task.entity';
import { BookingPresenceEvent } from '../booking-presence/entities/booking-presence-event.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { RequestKpiAdjustmentDto, DecideKpiAdjustmentDto } from './dto/kpi.dto';

export const DEFAULT_KPI_WEIGHTS: Record<string, number> = {
  FIRST_RESPONSE_SLA: 10,
  PRE_ARRIVAL_PREP: 10,
  CHECKIN_CHECKOUT_PROCESS: 15,
  SERVICE_REQUEST_SLA: 15,
  COMPLAINT_RESOLUTION: 10,
  COMPLIANCE_ACCURACY: 10,
  GUEST_RATING: 20,
  MANAGER_EVALUATION: 10,
};

@Injectable()
export class KpiCalculationService {
  private readonly logger = new Logger(KpiCalculationService.name);

  constructor(
    @InjectRepository(StaffKpiPeriodScore)
    private readonly periodScoreRepo: Repository<StaffKpiPeriodScore>,
    @InjectRepository(StaffKpiMetricScore)
    private readonly metricScoreRepo: Repository<StaffKpiMetricScore>,
    @InjectRepository(StaffKpiAdjustment)
    private readonly adjustmentRepo: Repository<StaffKpiAdjustment>,
    @InjectRepository(GuestStaffReview)
    private readonly reviewRepo: Repository<GuestStaffReview>,
    @InjectRepository(GuestWorkEvent)
    private readonly workEventRepo: Repository<GuestWorkEvent>,
    @InjectRepository(GuestWorkTask)
    private readonly taskRepo: Repository<GuestWorkTask>,
    @InjectRepository(BookingPresenceEvent)
    private readonly presenceEventRepo: Repository<BookingPresenceEvent>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
  ) {}

  async calculatePeriodScore(
    hotelId: string,
    staffUserId: string,
    periodKey: string,
  ): Promise<StaffKpiPeriodScore> {
    const [yearStr, monthStr] = periodKey.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    // 1. Thu thập dữ liệu task
    const tasks = await this.taskRepo.find({
      where: {
        hotelId,
        assignedStaffId: staffUserId,
        createdAt: Between(startDate, endDate),
      },
    });

    // 2. Thu thập sự kiện làm việc
    const workEvents = await this.workEventRepo.find({
      where: {
        hotelId,
        actorStaffId: staffUserId,
        occurredAt: Between(startDate, endDate),
      },
    });

    // 3. Thu thập đánh giá từ khách
    const reviews = await this.reviewRepo.find({
      where: {
        hotelId,
        staffUserId,
        status: 'ACTIVE',
        submittedAt: Between(startDate, endDate),
      },
    });

    // 4. Thu thập điều chỉnh của Quản lý đã được duyệt
    const adjustments = await this.adjustmentRepo.find({
      where: {
        hotelId,
        staffUserId,
        periodKey,
        status: AdjustmentStatus.APPROVED,
      },
    });

    // Tính từng metric
    const metrics: Partial<StaffKpiMetricScore>[] = [];

    // M1: FIRST_RESPONSE_SLA (10đ)
    const tasksWithFirstResp = tasks.filter((t) => t.firstResponseAt !== null);
    const onTimeFirstResp = tasks.filter(
      (t) => t.firstResponseAt && t.responseSlaDueAt && t.firstResponseAt <= t.responseSlaDueAt,
    );
    metrics.push(
      this.buildMetricScore(
        'FIRST_RESPONSE_SLA',
        DEFAULT_KPI_WEIGHTS.FIRST_RESPONSE_SLA,
        onTimeFirstResp.length,
        tasks.length,
        tasksWithFirstResp.length,
      ),
    );

    // M2: PRE_ARRIVAL_PREP (10đ)
    const preArrivalTasks = tasks.filter((t) => t.type === 'PRE_ARRIVAL_CONTACT');
    const preArrivalCompleted = preArrivalTasks.filter((t) => t.status === WorkTaskStatus.COMPLETED || t.status === WorkTaskStatus.VERIFIED);
    metrics.push(
      this.buildMetricScore(
        'PRE_ARRIVAL_PREP',
        DEFAULT_KPI_WEIGHTS.PRE_ARRIVAL_PREP,
        preArrivalCompleted.length,
        preArrivalTasks.length,
        preArrivalCompleted.length,
      ),
    );

    // M3: CHECKIN_CHECKOUT_PROCESS (15đ)
    const checkinEvents = workEvents.filter((e) => e.eventType === WorkEventType.TASK_COMPLETED);
    metrics.push(
      this.buildMetricScore(
        'CHECKIN_CHECKOUT_PROCESS',
        DEFAULT_KPI_WEIGHTS.CHECKIN_CHECKOUT_PROCESS,
        checkinEvents.length > 0 ? checkinEvents.length : 1,
        checkinEvents.length > 0 ? checkinEvents.length : 1,
        checkinEvents.length,
      ),
    );

    // M4: SERVICE_REQUEST_SLA (15đ)
    const serviceTasks = tasks.filter((t) => t.type === 'SERVICE_REQUEST');
    const onTimeService = serviceTasks.filter(
      (t) => t.completedAt && t.resolutionSlaDueAt && t.completedAt <= t.resolutionSlaDueAt,
    );
    metrics.push(
      this.buildMetricScore(
        'SERVICE_REQUEST_SLA',
        DEFAULT_KPI_WEIGHTS.SERVICE_REQUEST_SLA,
        onTimeService.length,
        serviceTasks.length,
        onTimeService.length,
      ),
    );

    // M5: COMPLAINT_RESOLUTION (10đ)
    const complaintTasks = tasks.filter((t) => t.type === 'COMPLAINT_HANDLE');
    const resolvedComplaints = complaintTasks.filter((t) => t.status === WorkTaskStatus.COMPLETED || t.status === WorkTaskStatus.VERIFIED);
    metrics.push(
      this.buildMetricScore(
        'COMPLAINT_RESOLUTION',
        DEFAULT_KPI_WEIGHTS.COMPLAINT_RESOLUTION,
        resolvedComplaints.length,
        complaintTasks.length,
        resolvedComplaints.length,
      ),
    );

    // M6: COMPLIANCE_ACCURACY (10đ) - Mặc định tuân thủ đầy đủ nếu không vi phạm
    metrics.push(
      this.buildMetricScore(
        'COMPLIANCE_ACCURACY',
        DEFAULT_KPI_WEIGHTS.COMPLIANCE_ACCURACY,
        1,
        1,
        1,
      ),
    );

    // M7: GUEST_RATING (20đ)
    if (reviews.length > 0) {
      const avgStars = reviews.reduce((acc, r) => acc + r.stars, 0) / reviews.length;
      const normalized = Math.min(1, Math.max(0, (avgStars - 1) / 4));
      const score = Number((normalized * DEFAULT_KPI_WEIGHTS.GUEST_RATING).toFixed(2));
      metrics.push({
        metricCode: 'GUEST_RATING',
        weight: DEFAULT_KPI_WEIGHTS.GUEST_RATING,
        eligible: true,
        numerator: reviews.reduce((acc, r) => acc + r.stars, 0),
        denominator: reviews.length * 5,
        rawValue: Number(avgStars.toFixed(2)),
        score,
        evidenceCount: reviews.length,
        noDataReason: null,
      });
    } else {
      metrics.push({
        metricCode: 'GUEST_RATING',
        weight: DEFAULT_KPI_WEIGHTS.GUEST_RATING,
        eligible: false,
        numerator: 0,
        denominator: 0,
        rawValue: 0,
        score: 0,
        evidenceCount: 0,
        noDataReason: 'Khách hàng chưa để lại đánh giá sao trong kỳ',
      });
    }

    // M8: MANAGER_EVALUATION (10đ) - Áp dụng điều chỉnh nếu có
    const managerDeltas = adjustments.reduce((acc, a) => acc + Number(a.delta), 0);
    const managerScore = Math.min(10, Math.max(0, 10 + managerDeltas));
    metrics.push({
      metricCode: 'MANAGER_EVALUATION',
      weight: DEFAULT_KPI_WEIGHTS.MANAGER_EVALUATION,
      eligible: true,
      numerator: 10 + managerDeltas,
      denominator: 10,
      rawValue: managerScore,
      score: managerScore,
      evidenceCount: adjustments.length,
      noDataReason: null,
    });

    // Tính toán tổng điểm tái cân bằng (Rebalanced total score)
    let applicableWeights = 0;
    let achievedScores = 0;
    for (const m of metrics) {
      if (m.eligible) {
        applicableWeights += Number(m.weight);
        achievedScores += Number(m.score);
      }
    }

    const totalScore = applicableWeights > 0 ? Number(((achievedScores / applicableWeights) * 100).toFixed(2)) : 0;
    const coverageRatio = Number(((applicableWeights / 100) * 100).toFixed(2));
    const sampleCount = tasks.length + workEvents.length + reviews.length;

    // Tìm hoặc tạo PeriodScore
    let periodScore = await this.periodScoreRepo.findOne({
      where: { hotelId, staffUserId, periodKey },
      relations: ['metrics'],
    });

    if (!periodScore) {
      periodScore = this.periodScoreRepo.create({
        hotelId,
        staffUserId,
        periodKey,
        policyVersion: 'v1.0',
        calculationVersion: 1,
        totalScore,
        coverageRatio,
        sampleCount,
        status: KpiPeriodStatus.DRAFT,
        calculatedAt: new Date(),
      });
    } else {
      if (periodScore.status === KpiPeriodStatus.LOCKED) {
        throw new ConflictException(`Kỳ KPI ${periodKey} đã bị khóa, không thể tự động tính lại`);
      }
      periodScore.totalScore = totalScore;
      periodScore.coverageRatio = coverageRatio;
      periodScore.sampleCount = sampleCount;
      periodScore.calculationVersion += 1;
      periodScore.calculatedAt = new Date();
    }

    const savedPeriod = await this.periodScoreRepo.save(periodScore);

    // Xóa metric cũ nếu có rồi lưu metric mới
    if (periodScore.metrics && periodScore.metrics.length > 0) {
      await this.metricScoreRepo.remove(periodScore.metrics);
    }
    const metricEntities = metrics.map((m) =>
      this.metricScoreRepo.create({
        ...m,
        periodScoreId: savedPeriod.id,
      }),
    );
    await this.metricScoreRepo.save(metricEntities);
    savedPeriod.metrics = metricEntities;

    return savedPeriod;
  }

  private buildMetricScore(
    code: string,
    weight: number,
    numerator: number,
    denominator: number,
    evidenceCount: number,
  ): Partial<StaffKpiMetricScore> {
    if (denominator === 0) {
      return {
        metricCode: code,
        weight,
        eligible: false,
        numerator: 0,
        denominator: 0,
        rawValue: 0,
        score: 0,
        evidenceCount: 0,
        noDataReason: 'Chưa phát sinh nhiệm vụ thuộc chỉ tiêu này trong kỳ',
      };
    }

    const rawValue = Math.min(1, Math.max(0, numerator / denominator));
    const score = Number((rawValue * weight).toFixed(2));
    return {
      metricCode: code,
      weight,
      eligible: true,
      numerator,
      denominator,
      rawValue: Number((rawValue * 100).toFixed(2)),
      score,
      evidenceCount,
      noDataReason: null,
    };
  }

  async getStaffPeriodScore(
    hotelId: string,
    staffUserId: string,
    periodKey: string,
  ): Promise<StaffKpiPeriodScore> {
    let score = await this.periodScoreRepo.findOne({
      where: { hotelId, staffUserId, periodKey },
      relations: ['metrics'],
    });

    if (!score) {
      score = await this.calculatePeriodScore(hotelId, staffUserId, periodKey);
    }

    return score;
  }

  async getHotelPeriodScores(hotelId: string, periodKey: string): Promise<StaffKpiPeriodScore[]> {
    return await this.periodScoreRepo.find({
      where: { hotelId, periodKey },
      relations: ['metrics'],
      order: { totalScore: 'DESC' },
    });
  }

  async approvePeriod(
    hotelId: string,
    periodKey: string,
    managerUserId: string,
    reviewNote?: string,
  ): Promise<number> {
    const isManager = await this.staffAvailabilityService.isManagerAtHotel(managerUserId, hotelId);
    if (!isManager) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền phê duyệt kỳ KPI');
    }

    const scores = await this.periodScoreRepo.find({ where: { hotelId, periodKey } });
    const now = new Date();
    for (const s of scores) {
      if (s.status === KpiPeriodStatus.DRAFT) {
        s.status = KpiPeriodStatus.APPROVED;
        s.approvedBy = managerUserId;
        s.approvedAt = now;
        s.reviewNote = reviewNote || null;
        await this.periodScoreRepo.save(s);
      }
    }
    return scores.length;
  }

  async requestAdjustment(
    hotelId: string,
    requestedBy: string,
    dto: RequestKpiAdjustmentDto,
  ): Promise<StaffKpiAdjustment> {
    const isManager = await this.staffAvailabilityService.isManagerAtHotel(requestedBy, hotelId);
    if (!isManager) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền đề xuất điều chỉnh KPI');
    }

    const adj = this.adjustmentRepo.create({
      hotelId,
      staffUserId: dto.staffUserId,
      periodKey: dto.periodKey,
      metricCode: dto.metricCode,
      delta: dto.delta,
      evidenceRef: dto.evidenceRef || null,
      reason: dto.reason,
      status: AdjustmentStatus.APPROVED, // Quản lý trực tiếp duyệt khi có căn cứ
      requestedBy,
      reviewedBy: requestedBy,
      reviewedAt: new Date(),
    });
    const saved = await this.adjustmentRepo.save(adj);

    // Tính lại KPI sau điều chỉnh
    await this.calculatePeriodScore(hotelId, dto.staffUserId, dto.periodKey);

    return saved;
  }
}

