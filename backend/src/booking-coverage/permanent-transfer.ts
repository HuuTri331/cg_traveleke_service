import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingAssignment } from '../booking-assignment/entities/booking-assignment.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { BookingCoverageGrant, CoverageGrantStatus } from './entities/booking-coverage-grant.entity';
import { BookingCoverageEvent, CoverageEventType } from './entities/booking-coverage-event.entity';
import { PermanentTransferDto } from './dto/permanent-transfer.dto';
import { assertDelegate } from './coverage-commands';
import { requireActiveStaff, requireManager } from './coverage-policy';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';

async function assertPermanentEligibility(em: EntityManager, booking: Booking, dto: PermanentTransferDto, actorRole: string) {
  if (!booking.handledBy) throw new ConflictException('Booking chưa có người phụ trách chính.');
  const [owner] = await em.query(`SELECT hs.status AS staffStatus, u.status AS userStatus, u.deleted_at AS deletedAt
    FROM hotel_staff hs JOIN users u ON u.id = hs.staff_user_id WHERE hs.hotel_id = ? AND hs.staff_user_id = ?`,
    [booking.hotelId, booking.handledBy]);
  const ownerActive = owner && owner.staffStatus === 'ACTIVE' && owner.userStatus === 'ACTIVE' && !owner.deletedAt;
  if (!ownerActive) return;
  if (dto.reasonCode !== 'ADMIN_OVERRIDE' || actorRole !== 'ADMIN') {
    throw new ConflictException('Nhân viên phụ trách vẫn ACTIVE tại khách sạn. Nghỉ phép/đi muộn phải dùng hỗ trợ tạm thời, không chuyển chủ booking.');
  }
}
export async function executePermanentTransfer(em: EntityManager, bookingId: string,
  actor: { id: string; role: string }, dto: PermanentTransferDto) {
  const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
  if (!booking) throw new NotFoundException('Không tìm thấy booking.');
  if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
    throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu đơn đặt phòng.');
  }
  await requireManager(em, booking.hotelId, actor);
  if (![BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.NO_SHOW, BookingStatus.CHECKED_IN].includes(booking.status)) {
    throw new ConflictException('Trạng thái booking không cho phép bàn giao.');
  }
  if (dto.commandId) {
    const prior = await em.findOne(BookingAssignment, { where: { bookingId, sourceEventId: dto.commandId } });
    if (prior) {
      if (String(prior.staffUserId) !== dto.toStaffUserId || String(prior.assignedBy) !== actor.id) throw new ConflictException('commandId đã được dùng cho yêu cầu khác.');
      return { message: 'Chuyển giao trách nhiệm đơn thành công', booking, staffId: dto.toStaffUserId };
    }
  }
  await assertPermanentEligibility(em, booking, dto, actor.role);
  if (String(booking.handledBy) === dto.toStaffUserId) throw new BadRequestException('Người nhận bàn giao phải khác người phụ trách hiện tại.');
  const now = new Date();
  await assertDelegate(em, booking, dto.toStaffUserId, now, new Date(Math.max(now.getTime() + 900000, new Date(booking.checkOutAt).getTime())));
  await em.query('SELECT hotel_id FROM hotel_assignment_dispatch_locks WHERE hotel_id = ? FOR UPDATE', [booking.hotelId]);
  let state = await em.findOne(BookingAssignmentState, { where: { bookingId }, lock: { mode: 'pessimistic_write' } });
  if (dto.expectedAssignmentVersion !== undefined && dto.expectedAssignmentVersion !== (state?.version || 0)) {
    throw new ConflictException('Phiên bản phân công đã thay đổi.');
  }
  const current = await em.findOne(BookingAssignment, { where: { bookingId, endedAt: IsNull() }, lock: { mode: 'pessimistic_write' }, order: { assignmentVersion: 'DESC' } });
  if (current) { current.endedAt = now; await em.save(BookingAssignment, current); }
  const next = await em.save(BookingAssignment, em.create(BookingAssignment, {
    bookingId, hotelId: booking.hotelId, staffUserId: dto.toStaffUserId,
    assignmentVersion: Math.max(state?.version || 0, current?.assignmentVersion || 0) + 1,
    assignedAt: now, assignmentType: 'MANUAL_OVERRIDE' as any, previousAssignmentId: current?.id || null,
    assignedBy: actor.id, reason: `${dto.reasonCode}: ${dto.reason}`, sourceEventId: dto.commandId || 'PERMANENT_TRANSFER',
  }));
  state = state ? Object.assign(state, { currentStaffId: dto.toStaffUserId, currentAssignmentId: next.id, status: 'ASSIGNED' as any, version: state.version + 1 })
    : em.create(BookingAssignmentState, { bookingId, currentStaffId: dto.toStaffUserId, currentAssignmentId: next.id, status: 'ASSIGNED' as any, version: 1 });
  await em.save(BookingAssignmentState, state);

  const decisions = new Map((dto.taskDecisions || []).map((d) => [d.taskId, d]));
  const tasks = await em.getRepository(GuestWorkTask).createQueryBuilder('t').setLock('pessimistic_write').where('t.booking_id = :bookingId', { bookingId }).orderBy('t.id', 'ASC').getMany();
  const keptGrants = new Set<string>();
  for (const task of tasks) {
    if (!['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(task.status)) continue;
    const prevAssignee = task.assignedStaffId, prevExecutor = task.activeExecutorId, fromStatus = task.status;
    if (['ACCEPTED', 'IN_PROGRESS'].includes(task.status)) {
      const decision = decisions.get(String(task.id));
      if (!decision) throw new ConflictException(`Task #${task.id} đang thực hiện; quản lý phải chọn CONTINUE hoặc HANDOVER.`);
      if (decision.action === 'CONTINUE') {
        const executor = task.activeExecutorId || task.assignedStaffId;
        if (!executor || String(executor) === String(booking.handledBy)) throw new ConflictException(`Người thực hiện task #${task.id} không còn hợp lệ để tiếp tục.`);
        await requireActiveStaff(em, booking.hotelId, executor);
        const lease = new Date(decision.leaseUntil || '');
        if (!Number.isFinite(lease.getTime()) || lease <= now || lease > new Date(booking.checkOutAt)) throw new BadRequestException(`leaseUntil của task #${task.id} không hợp lệ.`);
        task.assignedStaffId = dto.toStaffUserId; task.activeExecutorId = executor; task.executionLeaseUntil = lease; task.version += 1;
        if (task.coverageGrantId) keptGrants.add(String(task.coverageGrantId));
        await em.save(GuestWorkTask, task);
        await em.save(GuestWorkEvent, em.create(GuestWorkEvent, { taskId: task.id, bookingId, hotelId: booking.hotelId, actorType: 'USER', actorStaffId: actor.id, eventType: WorkEventType.TASK_ASSIGNED, fromStatus, toStatus: task.status, occurredAt: now, evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: `CONTINUE:${executor}->owner:${dto.toStaffUserId}:${decision.reason}` }));
        continue;
      }
      task.status = 'ASSIGNED' as any; task.startedAt = null;
    } else if (task.status === 'CREATED') task.status = 'ASSIGNED' as any;
    task.assignedStaffId = dto.toStaffUserId; task.activeExecutorId = null; task.coverageGrantId = null; task.executionLeaseUntil = null; task.version += 1;
    await em.save(GuestWorkTask, task);
    await em.save(GuestWorkEvent, em.create(GuestWorkEvent, { taskId: task.id, bookingId, hotelId: booking.hotelId, actorType: 'USER', actorStaffId: actor.id, eventType: ['ACCEPTED', 'IN_PROGRESS'].includes(fromStatus) ? WorkEventType.TASK_HANDOVER_REQUIRED : WorkEventType.TASK_ASSIGNED, fromStatus, toStatus: task.status, occurredAt: now, evidenceType: WorkEvidenceType.SYSTEM_LOG, evidenceRef: `HANDOVER:${prevExecutor || prevAssignee || 'none'}->${dto.toStaffUserId}` }));
  }
  const grants = await em.getRepository(BookingCoverageGrant).createQueryBuilder('g').setLock('pessimistic_write').where("g.booking_id = :bookingId AND g.status = 'ACTIVE'", { bookingId }).orderBy('g.id', 'ASC').getMany();
  for (const g of grants) {
    if (keptGrants.has(String(g.id)) && String(g.delegateStaffId) !== dto.toStaffUserId) continue;
    g.status = CoverageGrantStatus.REVOKED; g.version += 1; await em.save(BookingCoverageGrant, g);
    await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, { grantId: g.id, bookingId, actorId: actor.id, eventType: CoverageEventType.GRANT_REVOKED, note: `Thu hồi khi chuyển chủ sang #${dto.toStaffUserId}` }));
  }
  const prevOwner = booking.handledBy;
  Object.assign(booking, { handledBy: dto.toStaffUserId, assignmentType: 'MANUAL', assignmentNote: `${dto.reasonCode}: ${dto.reason}`, reassignedBy: actor.id, reassignedAt: now });
  await em.save(Booking, booking);
  await em.save(BookingCoverageEvent, em.create(BookingCoverageEvent, { bookingId, actorId: actor.id, eventType: CoverageEventType.PERMANENT_TRANSFER, oldValue: { previousStaffUserId: prevOwner }, newValue: { newStaffUserId: dto.toStaffUserId, reasonCode: dto.reasonCode, commandId: dto.commandId || null }, note: dto.reason }));
  return { message: 'Chuyển giao trách nhiệm đơn thành công', booking, staffId: dto.toStaffUserId };
}
