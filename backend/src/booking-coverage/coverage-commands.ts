import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { StaffAbsenceRequest, AbsenceRequestStatus } from '../staff-availability/entities/staff-absence-request.entity';
import { BookingCoverageGrant, CoverageGrantStatus, CoverageTaskType } from './entities/booking-coverage-grant.entity';
import { BookingCoverageEvent, CoverageEventType } from './entities/booking-coverage-event.entity';
import { CreateTemporaryCoverageDto } from './dto/create-temporary-coverage.dto';
import { coverageAllows, OPERATION_TASKS, requireActiveStaff, requireManager } from './coverage-policy';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { loadAssignmentCandidates } from '../booking-assignment/candidate-loader';
import { RoomServiceTier } from '../rooms/entities/room.entity';

export async function assertDelegate(em: EntityManager, booking: Booking, staffId: string, start: Date, end: Date) {
  await requireActiveStaff(em, booking.hotelId, staffId);
  const [block] = await em.query(`SELECT id FROM staff_availability_blocks WHERE hotel_id = ?
    AND staff_user_id = ? AND active = 1 AND start_at < ? AND end_at > ? LIMIT 1`, [booking.hotelId, staffId, end, start]);
  if (block) throw new ConflictException('Nhân viên hỗ trợ vắng mặt trong khoảng được giao.');
  const [tier] = await em.query(`SELECT MAX(CASE r.service_tier WHEN 'VIP' THEN 2 ELSE 1 END) AS difficulty
    FROM booking_rooms br JOIN rooms r ON r.id = br.room_id WHERE br.booking_id = ?`, [booking.id]);
  const candidates = await loadAssignmentCandidates(em, booking.hotelId,
    Number(tier.difficulty) === 2 ? RoomServiceTier.VIP : RoomServiceTier.STANDARD, start);
  const candidate = candidates.find((c) => String(c.staffUserId) === String(staffId));
  // No 40/120 check: coverage is not a new booking assignment.
  if (!candidate || (!candidate.hasVerifiedSkill && candidate.staffRole !== 'MANAGER')) {
    throw new ConflictException('Nhân sự nhận hỗ trợ chưa đủ năng lực cho booking.');
  }
}
export async function assertCoverageInterval(
  em: EntityManager, booking: Booking, start: Date, end: Date, absenceId?: string | null,
) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start ||
      end.getTime() - start.getTime() < 15 * 60000) throw new BadRequestException('Khoảng hỗ trợ phải từ 15 phút, có hạn kết thúc.');
  if (absenceId) {
    const absence = await em.findOne(StaffAbsenceRequest, { where: { id: absenceId }, lock: { mode: 'pessimistic_read' } });
    if (!absence || absence.status !== AbsenceRequestStatus.APPROVED ||
        String(absence.hotelId) !== String(booking.hotelId) || String(absence.staffUserId) !== String(booking.handledBy) ||
        start < new Date(absence.startAt) || end > new Date(absence.endAt)) {
      throw new ConflictException('Coverage phải nằm trong đơn vắng đã duyệt của chủ booking tại khách sạn này.');
    }
  } else if (end.getTime() - start.getTime() > 24 * 3600000) {
    throw new BadRequestException('Hỗ trợ hơn 24 giờ phải liên kết đơn vắng đã duyệt; không chuyển chủ vì nghỉ dài ngày.');
  }
}
export async function assertNoOverlappingCoverage(
  em: EntityManager,
  bookingId: string,
  start: Date,
  end: Date,
  mode: 'TASK_IDS' | 'TASK_TYPES' | 'BOOKING_TASKS',
  allowedTaskTypes: string[],
  taskIds: string[],
  excludeGrantId?: string,
) {
  const existingGrants = await em
    .getRepository(BookingCoverageGrant)
    .createQueryBuilder('g')
    .where('g.booking_id = :bookingId', { bookingId })
    .andWhere("g.status IN ('ACTIVE', 'SCHEDULED', 'APPROVED_PENDING_ACCEPTANCE')")
    .andWhere('g.start_at < :end AND g.end_at > :start', { start, end })
    .orderBy('g.id', 'ASC')
    .getMany();

  for (const g of existingGrants) {
    if (excludeGrantId && String(g.id) === String(excludeGrantId)) continue;
    if (g.startAt && g.endAt && !(new Date(g.startAt) < end && start < new Date(g.endAt))) continue;
    const gMode = g.scopeMode || 'TASK_TYPES';
    if (mode === 'BOOKING_TASKS' || gMode === 'BOOKING_TASKS') {
      throw new ConflictException(
        `COVERAGE_SCOPE_CONFLICT: Quyền hỗ trợ #${g.id} đang hiệu lực hoặc chờ nhận trùng khoảng thời gian và phạm vi toàn đơn.`,
      );
    }
    if (mode === 'TASK_TYPES' && gMode === 'TASK_TYPES') {
      const gTypes = Array.isArray(g.allowedTaskTypes) ? g.allowedTaskTypes : [];
      const hasTypeOverlap = OPERATION_TASKS.some(
        (op) => coverageAllows(allowedTaskTypes, op) && coverageAllows(gTypes, op),
      );
      if (hasTypeOverlap) {
        throw new ConflictException(
          `COVERAGE_SCOPE_CONFLICT: Quyền hỗ trợ #${g.id} trùng khoảng thời gian và loại công việc ủy quyền.`,
        );
      }
    }
    if (mode === 'TASK_IDS' && gMode === 'TASK_IDS' && taskIds.length > 0) {
      const existingTaskScopes = await em.query(
        `SELECT task_id AS taskId FROM booking_coverage_task_scopes WHERE grant_id = ?`,
        [g.id],
      );
      const existingSet = new Set((existingTaskScopes || []).map((r: any) => String(r.taskId)));
      if (taskIds.some((id) => existingSet.has(String(id)))) {
        throw new ConflictException(
          `COVERAGE_SCOPE_CONFLICT: Quyền hỗ trợ #${g.id} đã bao gồm nhiệm vụ nằm trong danh sách TASK_IDS.`,
        );
      }
    }
  }
}

export async function createCoverage(em: EntityManager, bookingId: string,
  actor: {id: string; role: string}, dto: CreateTemporaryCoverageDto) {
  const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: {mode:'pessimistic_write'} });
  if (!booking) throw new NotFoundException('Không tìm thấy booking.');
  if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
    throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu đơn đặt phòng.');
  }
  await requireManager(em, booking.hotelId, actor);
  if (!booking.handledBy || ![BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.NO_SHOW, BookingStatus.CHECKED_IN].includes(booking.status)) {
    throw new ConflictException('Booking phải đang hoạt động và có người phụ trách.');
  }
  if (dto.commandId) {
    const prior = await em.findOne(BookingCoverageGrant, {where:{bookingId, commandKey:dto.commandId}});
    if (prior) {
      if (String(prior.delegateStaffId) !== dto.delegateStaffUserId || String(prior.createdBy) !== actor.id) throw new ConflictException('commandId đã được dùng cho yêu cầu khác.');
      return prior;
    }
  }
  const state = await em.findOne(BookingAssignmentState, {where:{bookingId},lock:{mode:'pessimistic_write'}});
  if (dto.expectedAssignmentVersion !== undefined && dto.expectedAssignmentVersion !== (state?.version || 0)) throw new ConflictException('Phiên bản phân công đã thay đổi.');
  const start = new Date(dto.startAt), end = new Date(dto.endAt);
  await assertCoverageInterval(em, booking, start, end, dto.absenceRequestId);
  if (end <= new Date() || String(booking.handledBy) === dto.delegateStaffUserId) throw new BadRequestException('Người hỗ trợ phải khác chủ booking; thời hạn chưa kết thúc.');
  await assertDelegate(em, booking, dto.delegateStaffUserId, start, end);
  const mode = dto.scopeMode || 'TASK_TYPES';
  const taskIds = [...new Set(dto.taskIds || [])];
  if (mode === 'TASK_IDS') {
    if (!taskIds.length) throw new BadRequestException('Phạm vi TASK_IDS không được rỗng.');
    for (const id of taskIds) {
      const task = await em.findOne(GuestWorkTask, {where:{id, bookingId, hotelId:booking.hotelId}});
      if (!task) throw new BadRequestException('Task phải thuộc đúng booking và khách sạn.');
    }
  } else if (mode === 'TASK_TYPES') {
    if (!dto.allowedTaskTypes?.length || dto.allowedTaskTypes.some((t) => !Object.values(CoverageTaskType).includes(t))) throw new BadRequestException('Phạm vi loại việc không hợp lệ.');
  } else if (mode !== 'BOOKING_TASKS') throw new BadRequestException('scopeMode không hợp lệ.');
  const deadline = dto.completionDeadline ? new Date(dto.completionDeadline) : end;
  if (!Number.isFinite(deadline.getTime()) || deadline < end || deadline > new Date(booking.checkOutAt)) throw new BadRequestException('Hạn hoàn tất phải từ lúc hết grant đến trước/khi kết thúc kỳ lưu trú.');

  // P0-03: Chặn cấp chồng lấn thời gian và phạm vi trên cùng một booking
  await assertNoOverlappingCoverage(em, bookingId, start, end, mode, dto.allowedTaskTypes || [], taskIds);

  const now = new Date();
  const initialStatus = CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE;

  const grant = await em.save(BookingCoverageGrant, em.create(BookingCoverageGrant, {
    bookingId, hotelId:booking.hotelId, principalStaffId:booking.handledBy, delegateStaffId:dto.delegateStaffUserId,
    mode:'TEMPORARY', scopeMode:mode, absenceRequestId:dto.absenceRequestId || null,
    startAt:start, endAt:end, completionDeadline:deadline, allowedTaskTypes:dto.allowedTaskTypes || [],
    status:initialStatus, createdBy:actor.id, requestedBy:actor.id, approvedBy:actor.id, approvedAt:now,
    acceptedBy: null,
    acceptedAt: null,
    acceptDeadline: new Date(Math.min(end.getTime(), Math.max(start.getTime(), now.getTime() + 30 * 60000))),
    reason:dto.reason, commandKey:dto.commandId || null, version:1,
  }));
  for (const id of taskIds) await em.query('INSERT INTO booking_coverage_task_scopes(grant_id,task_id) VALUES (?,?)', [grant.id,id]);
  await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, {
    grantId:grant.id, bookingId, actorId:actor.id,
    eventType: initialStatus === CoverageGrantStatus.APPROVED_PENDING_ACCEPTANCE ? CoverageEventType.GRANT_APPROVED : CoverageEventType.GRANT_CREATED,
    newValue:{ scopeMode:mode, taskIds, status:initialStatus, completionDeadline:deadline.toISOString(), startAt:start, endAt:end }, note:dto.reason,
  }));
  return grant;
}

