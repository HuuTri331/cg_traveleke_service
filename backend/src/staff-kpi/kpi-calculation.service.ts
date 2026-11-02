import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { BookingPresenceEvent } from '../booking-presence/entities/booking-presence-event.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskStatus, WorkTaskType } from '../guest-work/entities/guest-work-task.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { DecideKpiAdjustmentDto, RequestKpiAdjustmentDto } from './dto/kpi.dto';
import { GuestStaffReview } from './entities/guest-staff-review.entity';
import { AdjustmentStatus, StaffKpiAdjustment } from './entities/staff-kpi-adjustment.entity';
import { StaffKpiMetricScore } from './entities/staff-kpi-metric-score.entity';
import { KpiPeriodStatus, StaffKpiPeriodScore } from './entities/staff-kpi-period-score.entity';

export const DEFAULT_KPI_WEIGHTS: Record<string, number> = {
  FIRST_RESPONSE_SLA: 10, PRE_ARRIVAL_PREP: 10, CHECKIN_CHECKOUT_PROCESS: 15,
  SERVICE_REQUEST_SLA: 15, COMPLAINT_RESOLUTION: 10, COMPLIANCE_ACCURACY: 10,
  GUEST_RATING: 20, MANAGER_EVALUATION: 10,
};

@Injectable()
export class KpiCalculationService {
  private readonly logger = new Logger(KpiCalculationService.name);

  constructor(
    @InjectRepository(StaffKpiPeriodScore) private readonly periodScoreRepo: Repository<StaffKpiPeriodScore>,
    @InjectRepository(StaffKpiMetricScore) private readonly metricScoreRepo: Repository<StaffKpiMetricScore>,
    @InjectRepository(StaffKpiAdjustment) private readonly adjustmentRepo: Repository<StaffKpiAdjustment>,
    @InjectRepository(GuestStaffReview) private readonly reviewRepo: Repository<GuestStaffReview>,
    @InjectRepository(GuestWorkEvent) private readonly workEventRepo: Repository<GuestWorkEvent>,
    @InjectRepository(GuestWorkTask) private readonly taskRepo: Repository<GuestWorkTask>,
    @InjectRepository(BookingPresenceEvent) private readonly presenceEventRepo: Repository<BookingPresenceEvent>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
  ) {}

  private periodBounds(periodKey: string): [Date, Date] {
    const [year, month] = periodKey.split('-').map((v) => parseInt(v, 10));
    // Half-open [start, nextMonthStart) in Vietnam hotel time (+07:00), represented as UTC instants.
    return [new Date(Date.UTC(year, month - 1, 1, -7)), new Date(Date.UTC(year, month, 1, -7))];
  }
  private inHalfOpen(d: Date | string | null | undefined, start: Date, end: Date) {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= start.getTime() && t < end.getTime();
  }
  private latestPerStaff(scores: StaffKpiPeriodScore[]) {
    const map = new Map<string, StaffKpiPeriodScore>();
    for (const s of [...scores].sort((a, b) => Number(b.calculationVersion || 0) - Number(a.calculationVersion || 0))) {
      if (!map.has(String(s.staffUserId))) map.set(String(s.staffUserId), s);
    }
    return [...map.values()].sort((a, b) => Number(b.totalScore) - Number(a.totalScore));
  }

  async calculatePeriodScore(hotelId: string, staffUserId: string, periodKey: string): Promise<StaffKpiPeriodScore> {
    const [startDate, endDate] = this.periodBounds(periodKey);
    const workEvents = (await this.workEventRepo.find({
      where: { hotelId, actorStaffId: staffUserId, occurredAt: Between(startDate, endDate) },
    })).filter((e) => this.inHalfOpen(e.occurredAt, startDate, endDate));
    const assignedTasks = (await this.taskRepo.find({
      where: { hotelId, assignedStaffId: staffUserId, createdAt: Between(startDate, endDate) },
    })).filter((t) => this.inHalfOpen(t.createdAt, startDate, endDate));
    const eventTaskIds = [...new Set(workEvents.map((e) => String(e.taskId)).filter(Boolean))]
      .filter((id) => !assignedTasks.some((t) => String(t.id) === id));
    const extraTasks = eventTaskIds.length ? (await this.taskRepo.find({ where: { id: In(eventTaskIds) } as any })) || [] : [];
    const taskMap = new Map([...assignedTasks, ...extraTasks].map((t) => [String(t.id), t]));
    const presenceEvents = ((await this.presenceEventRepo.find({
      where: { hotelId, actorId: staffUserId, occurredAt: Between(startDate, endDate) } as any,
    })) || []).filter((e) => this.inHalfOpen(e.occurredAt, startDate, endDate));
    const reviews = (await this.reviewRepo.find({
      where: { hotelId, staffUserId, status: 'ACTIVE', submittedAt: Between(startDate, endDate) },
    })).filter((r) => this.inHalfOpen(r.submittedAt, startDate, endDate));
    const adjustments = await this.adjustmentRepo.find({
      where: { hotelId, staffUserId, periodKey, status: AdjustmentStatus.APPROVED },
    });

    const verifiedEvent = (e: GuestWorkEvent) =>
      e.evidenceType !== WorkEvidenceType.SELF_REPORTED ||
      taskMap.get(String(e.taskId))?.status === WorkTaskStatus.VERIFIED;
    const completedByActor = (type?: WorkTaskType) => workEvents.filter((e) => {
      const t = taskMap.get(String(e.taskId));
      return e.eventType === WorkEventType.TASK_COMPLETED && verifiedEvent(e) &&
        (!type || t?.type === type) && t && [WorkTaskStatus.COMPLETED, WorkTaskStatus.VERIFIED].includes(t.status);
    });
    const failedForActor = (type?: WorkTaskType) => [...taskMap.values()].filter((t) =>
      (!type || t.type === type) && t.status === WorkTaskStatus.FAILED &&
      (String(t.activeExecutorId || t.assignedStaffId) === String(staffUserId) ||
       workEvents.some((e) => String(e.taskId) === String(t.id) && e.eventType === WorkEventType.TASK_COMPLETED)));

    const metrics: Partial<StaffKpiMetricScore>[] = [];
    // M1: First response belongs to the actor of the response event, even if the task is later transferred.
    const firstRespEvents = workEvents.filter((e) => e.evidenceType === WorkEvidenceType.MESSAGE);
    const onTimeResp = firstRespEvents.filter((e) => {
      const due = taskMap.get(String(e.taskId))?.responseSlaDueAt;
      return !due || new Date(e.occurredAt) <= new Date(due);
    });
    const missedResp = assignedTasks.filter((t) =>
      !t.firstResponseAt && String(t.activeExecutorId || t.assignedStaffId) === String(staffUserId) &&
      t.responseSlaDueAt && new Date(t.responseSlaDueAt) <= endDate);
    metrics.push(this.buildMetricScore('FIRST_RESPONSE_SLA', DEFAULT_KPI_WEIGHTS.FIRST_RESPONSE_SLA,
      onTimeResp.length, firstRespEvents.length + missedResp.length, firstRespEvents.length));

    const preCompleted = completedByActor(WorkTaskType.PRE_ARRIVAL_CONTACT);
    const preFailed = failedForActor(WorkTaskType.PRE_ARRIVAL_CONTACT);
    metrics.push(this.buildMetricScore('PRE_ARRIVAL_PREP', DEFAULT_KPI_WEIGHTS.PRE_ARRIVAL_PREP,
      preCompleted.length, preCompleted.length + preFailed.length, preCompleted.length));

    // M3: Check-in/out KPI requires checklist task completion/failure, not just clicking check-in.
    const checkCompleted = completedByActor(WorkTaskType.CHECK_IN).concat(completedByActor(WorkTaskType.CHECK_OUT));
    const checkFailed = failedForActor(WorkTaskType.CHECK_IN).concat(failedForActor(WorkTaskType.CHECK_OUT));
    const presenceCount = presenceEvents.filter((pe) =>
      ['ARRIVAL_CONFIRMED', 'LATE_CHECK_IN_RECOVERED', 'DEPARTURE_CONFIRMED'].includes(pe.eventType)).length;
    metrics.push(checkCompleted.length + checkFailed.length > 0
      ? this.buildMetricScore('CHECKIN_CHECKOUT_PROCESS', DEFAULT_KPI_WEIGHTS.CHECKIN_CHECKOUT_PROCESS,
          checkCompleted.length, checkCompleted.length + checkFailed.length, checkCompleted.length + checkFailed.length)
      : { metricCode: 'CHECKIN_CHECKOUT_PROCESS', weight: DEFAULT_KPI_WEIGHTS.CHECKIN_CHECKOUT_PROCESS,
          eligible: false, numerator: 0, denominator: 0, rawValue: 0, score: 0, evidenceCount: presenceCount,
          noDataReason: presenceCount ? `Đã ghi nhận ${presenceCount} lượt check-in/out nhưng chưa có checklist quy trình được nghiệm thu (N/A)` : 'Chưa phát sinh nhiệm vụ thuộc chỉ tiêu này trong kỳ' });

    // M4/M5: Resolution belongs to the actor of TASK_COMPLETED, not the assignee after a later transfer.
    const serviceCompleted = completedByActor(WorkTaskType.SERVICE_REQUEST);
    const serviceOnTime = serviceCompleted.filter((e) => {
      const due = taskMap.get(String(e.taskId))?.resolutionSlaDueAt;
      return !due || new Date(e.occurredAt) <= new Date(due);
    });
    const serviceFailed = failedForActor(WorkTaskType.SERVICE_REQUEST);
    metrics.push(this.buildMetricScore('SERVICE_REQUEST_SLA', DEFAULT_KPI_WEIGHTS.SERVICE_REQUEST_SLA,
      serviceOnTime.length, serviceCompleted.length + serviceFailed.length, serviceCompleted.length));

    const complaintCompleted = completedByActor(WorkTaskType.COMPLAINT_HANDLE);
    const complaintFailed = failedForActor(WorkTaskType.COMPLAINT_HANDLE);
    metrics.push(this.buildMetricScore('COMPLAINT_RESOLUTION', DEFAULT_KPI_WEIGHTS.COMPLAINT_RESOLUTION,
      complaintCompleted.length, complaintCompleted.length + complaintFailed.length, complaintCompleted.length));

    // M6: Compliance counts only four-eyes VERIFIED vs FAILED tasks; never TASK_CREATED/ASSIGNED.
    const verifiedTasks = [...taskMap.values()].filter((t) => t.status === WorkTaskStatus.VERIFIED &&
      workEvents.some((e) => String(e.taskId) === String(t.id) && e.eventType === WorkEventType.TASK_COMPLETED));
    const failedTasks = failedForActor();
    metrics.push(this.buildMetricScore('COMPLIANCE_ACCURACY', DEFAULT_KPI_WEIGHTS.COMPLIANCE_ACCURACY,
      verifiedTasks.length, verifiedTasks.length + failedTasks.length, verifiedTasks.length + failedTasks.length));

    // M7: Fewer than 3 valid guest reviews is reference-only (PROVISIONAL), not official score.
    const avgStars = reviews.length ? reviews.reduce((a, r) => a + r.stars, 0) / reviews.length : 0;
    const ratingScore = Number((Math.min(1, Math.max(0, (avgStars - 1) / 4)) * DEFAULT_KPI_WEIGHTS.GUEST_RATING).toFixed(2));
    metrics.push({
      metricCode: 'GUEST_RATING', weight: DEFAULT_KPI_WEIGHTS.GUEST_RATING, eligible: reviews.length >= 3,
      numerator: reviews.reduce((a, r) => a + r.stars, 0), denominator: reviews.length * 5,
      rawValue: Number(avgStars.toFixed(2)), score: reviews.length >= 3 ? ratingScore : 0,
      evidenceCount: reviews.length,
      noDataReason: reviews.length === 0 ? 'Khách hàng chưa để lại đánh giá sao trong kỳ (N/A)'
        : reviews.length < 3 ? `PROVISIONAL: ${reviews.length}/3 đánh giá tối thiểu (${avgStars.toFixed(2)}★ tham khảo, chưa cộng vào điểm chính thức)` : null,
    });

    // M8: Manager rubric requires an explicit 0..10 score with evidence.
    const rubrics = adjustments.filter((a) => a.metricCode === 'MANAGER_EVALUATION' && a.evidenceRef);
    const latestRubric = [...rubrics].sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
    const rubricValue = latestRubric ? Math.min(10, Math.max(0, Number(latestRubric.delta))) : 0;
    metrics.push({
      metricCode: 'MANAGER_EVALUATION', weight: DEFAULT_KPI_WEIGHTS.MANAGER_EVALUATION, eligible: Boolean(latestRubric),
      numerator: Math.round(rubricValue), denominator: latestRubric ? 10 : 0,
      rawValue: rubricValue, score: rubricValue, evidenceCount: rubrics.length,
      noDataReason: latestRubric ? null : 'Quản lý chưa nhập rubric 0–10 kèm bằng chứng trong kỳ (N/A)',
    });

    let applicableWeights = 0;
    let achievedScores = 0;
    for (const m of metrics) if (m.eligible) { applicableWeights += Number(m.weight); achievedScores += Number(m.score); }
    const sampleCount = workEvents.filter(verifiedEvent).length + presenceCount + reviews.length + rubrics.length;
    const totalScore = applicableWeights > 0 ? Number(((achievedScores / applicableWeights) * 100).toFixed(2)) : 0;
    const coverageRatio = Number(applicableWeights.toFixed(2));
    const sourceHash = createHash('sha256').update(JSON.stringify({ staffUserId, periodKey, metrics, sampleCount })).digest('hex');

    const existing = await this.periodScoreRepo.find({ where: { hotelId, staffUserId, periodKey }, relations: ['metrics'] });
    const latest = [...existing].sort((a, b) => Number(b.calculationVersion || 0) - Number(a.calculationVersion || 0))[0] ||
      await this.periodScoreRepo.findOne({ where: { hotelId, staffUserId, periodKey }, relations: ['metrics'] });
    if (latest?.status === KpiPeriodStatus.LOCKED) {
      throw new ConflictException(`Kỳ KPI ${periodKey} đã bị khóa, không thể tự động tính lại`);
    }
    let periodScore: StaffKpiPeriodScore;
    if (!latest || latest.status === KpiPeriodStatus.APPROVED) {
      // Approved snapshots are immutable; recalculation creates a new revision row.
      periodScore = this.periodScoreRepo.create({
        hotelId, staffUserId, periodKey, policyVersion: 'v1.0',
        calculationVersion: Number(latest?.calculationVersion || 0) + 1,
        totalScore, coverageRatio, sampleCount, sourceHash,
        status: KpiPeriodStatus.DRAFT, calculatedAt: new Date(),
      });
    } else {
      if (latest.metrics?.length) await this.metricScoreRepo.remove(latest.metrics);
      periodScore = Object.assign(latest, {
        totalScore, coverageRatio, sampleCount, sourceHash,
        calculationVersion: Number(latest.calculationVersion || 0) + 1, calculatedAt: new Date(),
      });
    }
    const savedPeriod = await this.periodScoreRepo.save(periodScore);
    const metricEntities = metrics.map((m) => this.metricScoreRepo.create({ ...m, periodScoreId: savedPeriod.id }));
    await this.metricScoreRepo.save(metricEntities);
    savedPeriod.metrics = metricEntities;
    return savedPeriod;
  }

  private buildMetricScore(code: string, weight: number, numerator: number, denominator: number, evidenceCount: number): Partial<StaffKpiMetricScore> {
    if (denominator === 0) {
      return {
        metricCode: code, weight, eligible: false, numerator: 0, denominator: 0,
        rawValue: 0, score: 0, evidenceCount: 0, noDataReason: 'Chưa phát sinh nhiệm vụ thuộc chỉ tiêu này trong kỳ',
      };
    }
    const rawValue = Math.min(1, Math.max(0, numerator / denominator));
    return {
      metricCode: code, weight, eligible: true, numerator, denominator,
      rawValue: Number((rawValue * 100).toFixed(2)),
      score: Number((rawValue * weight).toFixed(2)), evidenceCount, noDataReason: null,
    };
  }

  async getStaffPeriodScore(hotelId: string, staffUserId: string, periodKey: string): Promise<StaffKpiPeriodScore> {
    const scores = await this.periodScoreRepo.find({ where: { hotelId, staffUserId, periodKey }, relations: ['metrics'] });
    const latest = this.latestPerStaff(scores)[0] ||
      await this.periodScoreRepo.findOne({ where: { hotelId, staffUserId, periodKey }, relations: ['metrics'] });
    return latest || this.calculatePeriodScore(hotelId, staffUserId, periodKey);
  }

  async getHotelPeriodScores(hotelId: string, periodKey: string): Promise<StaffKpiPeriodScore[]> {
    const scores = await this.periodScoreRepo.find({ where: { hotelId, periodKey }, relations: ['metrics'] });
    return this.latestPerStaff(scores);
  }

  async recalculateHotelPeriodScores(hotelId: string, periodKey: string, actor?: { id: string; role: string }) {
    if (actor && actor.role !== 'ADMIN' && !(await this.staffAvailabilityService.isManagerAtHotel(actor.id, hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn hoặc Quản trị viên mới có quyền tính lại KPI toàn cơ sở.');
    }
    const existingScores = await this.periodScoreRepo.find({ where: { hotelId, periodKey } });
    const staffUserIds = new Set(existingScores.map((s) => String(s.staffUserId)));
    const staffRows = await (this.periodScoreRepo as any).manager.query(
      `SELECT DISTINCT staff_user_id AS staffUserId FROM hotel_staff WHERE hotel_id = ? AND status = 'ACTIVE'`, [hotelId]);
    for (const r of staffRows || []) if (r.staffUserId) staffUserIds.add(String(r.staffUserId));
    const scores: StaffKpiPeriodScore[] = [];
    for (const staffId of staffUserIds) {
      scores.push(await this.calculatePeriodScore(hotelId, staffId, periodKey));
    }
    return { recalculatedCount: scores.length, scores };
  }

  async validateStaffAccess(actor: { id: string; role: string }, hotelId: string, targetStaffId?: string) {
    if (actor.role === 'ADMIN') return;
    if (targetStaffId && String(actor.id) === String(targetStaffId)) {
      if (!(await this.staffAvailabilityService.isStaffAtHotel(actor.id, hotelId))) {
        throw new ForbiddenException('Bạn không thuộc nhân sự của khách sạn này.');
      }
      return;
    }
    if (!(await this.staffAvailabilityService.isManagerAtHotel(actor.id, hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý của khách sạn này mới có quyền truy cập dữ liệu KPI nhân sự.');
    }
  }

  async approvePeriod(hotelId: string, periodKey: string, managerUserId: string, reviewNote?: string): Promise<number> {
    if (!(await this.staffAvailabilityService.isManagerAtHotel(managerUserId, hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền phê duyệt kỳ KPI');
    }
    const scores = await this.getHotelPeriodScores(hotelId, periodKey);
    const now = new Date();
    let approvedCount = 0;
    for (const s of scores) {
      // Never publish/approve insufficient-data snapshots as official scores.
      if (s.status === KpiPeriodStatus.DRAFT && Number(s.sampleCount) >= 3 && Number(s.coverageRatio) > 0) {
        s.status = KpiPeriodStatus.APPROVED;
        s.approvedBy = managerUserId;
        s.approvedAt = now;
        s.reviewNote = reviewNote || null;
        await this.periodScoreRepo.save(s);
        approvedCount++;
      }
    }
    return approvedCount;
  }

  async requestAdjustment(hotelId: string, requestedBy: string, dto: RequestKpiAdjustmentDto): Promise<StaffKpiAdjustment> {
    if (!(await this.staffAvailabilityService.isManagerAtHotel(requestedBy, hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền nhập rubric hoặc đề xuất hiệu chỉnh KPI');
    }
    if (String(requestedBy) === String(dto.staffUserId)) {
      throw new ForbiddenException('Quản lý không được tự chấm rubric hoặc tự điều chỉnh KPI của chính mình');
    }
    if (!dto.evidenceRef?.trim()) {
      throw new BadRequestException('Bắt buộc đính kèm bằng chứng/mã tham chiếu xác minh (evidenceRef).');
    }
    const isRubric = dto.metricCode === 'MANAGER_EVALUATION';
    if (isRubric && (Number(dto.delta) < 0 || Number(dto.delta) > 10)) {
      throw new BadRequestException('Điểm rubric của Quản lý phải nằm trong thang 0–10.');
    }
    const saved = await this.adjustmentRepo.save(this.adjustmentRepo.create({
      hotelId, staffUserId: dto.staffUserId, periodKey: dto.periodKey,
      metricCode: dto.metricCode, delta: dto.delta, evidenceRef: dto.evidenceRef.trim(),
      reason: dto.reason,
      // System/customer metrics cannot be directly overwritten by one manager; they stay REQUESTED for 4-eyes review.
      status: isRubric ? AdjustmentStatus.APPROVED : AdjustmentStatus.REQUESTED,
      requestedBy, reviewedBy: isRubric ? requestedBy : null, reviewedAt: isRubric ? new Date() : null,
    }));
    if (isRubric) await this.calculatePeriodScore(hotelId, dto.staffUserId, dto.periodKey);
    return saved;
  }

  async decideAdjustment(adjustmentId: string, reviewerUserId: string, dto: DecideKpiAdjustmentDto) {
    const adj = await this.adjustmentRepo.findOne({ where: { id: adjustmentId } });
    if (!adj) throw new NotFoundException(`Không tìm thấy đề xuất điều chỉnh #${adjustmentId}`);
    if (String(adj.requestedBy) === String(reviewerUserId)) {
      throw new ForbiddenException('Nguyên tắc 4-Eyes: Người đề xuất không được tự phê duyệt điều chỉnh KPI.');
    }
    if (!(await this.staffAvailabilityService.isManagerAtHotel(reviewerUserId, adj.hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền duyệt điều chỉnh KPI.');
    }
    adj.status = dto.decision === 'APPROVE' ? AdjustmentStatus.APPROVED : AdjustmentStatus.REJECTED;
    adj.reviewedBy = reviewerUserId;
    adj.reviewedAt = new Date();
    const saved = await this.adjustmentRepo.save(adj);
    if (saved.status === AdjustmentStatus.APPROVED) {
      await this.calculatePeriodScore(adj.hotelId, adj.staffUserId, adj.periodKey);
    }
    return saved;
  }
}
