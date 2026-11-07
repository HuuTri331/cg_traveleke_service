import { ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BookingCoverageGrant } from './entities/booking-coverage-grant.entity';

export const SERVICE_TASKS = ['SERVICE_REQUEST', 'SERVICE_RESPONSE'];
export const OPERATION_TASKS = [
  'PRE_ARRIVAL_CONTACT',
  'PRECHECKIN',
  'OCCUPANT_UPDATE',
  'CHECK_IN',
  'CHECK_OUT',
  'ROOM_ASSIGN',
  'ASSIGN_ROOM',
  'MOVE_ROOM',
  'ROOM_MOVE',
  'ROOM_INCIDENT',
  'MESSAGE',
  'SERVICE_REQUEST',
  'SERVICE_RESPONSE',
  'AMENDMENT_REQUEST',
  'AMEND_BOOKING',
  'ARRIVAL_SUPPORT',
  'FOLIO_SETTLEMENT',
  'FOLIO_ADJUSTMENT',
  'STAY_TIME_REQUEST',
  'STAY_TIME_EXTENSION',
  'COMPLAINT_HANDLE',
  'WRITE_BOOKING_STATUS',
];
export function coverageAllows(scopes: string[], taskType: string): boolean {
  if (!OPERATION_TASKS.includes(taskType)) return false;
  if (scopes.includes('BOOKING_TASKS') || scopes.includes(taskType)) return true;
  if (
    ['ROOM_ASSIGN', 'ASSIGN_ROOM', 'MOVE_ROOM', 'ROOM_MOVE'].includes(taskType) &&
    (scopes.includes('ROOM_ASSIGN') || scopes.includes('ASSIGN_ROOM') || scopes.includes('MOVE_ROOM') || scopes.includes('ROOM_MOVE'))
  ) {
    return true;
  }
  if (
    ['AMENDMENT_REQUEST', 'AMEND_BOOKING'].includes(taskType) &&
    (scopes.includes('AMENDMENT_REQUEST') || scopes.includes('AMEND_BOOKING'))
  ) {
    return true;
  }
  if (
    ['STAY_TIME_REQUEST', 'STAY_TIME_EXTENSION'].includes(taskType) &&
    (scopes.includes('STAY_TIME_REQUEST') || scopes.includes('STAY_TIME_EXTENSION'))
  ) {
    return true;
  }
  if (
    ['ROOM_INCIDENT', 'COMPLAINT_HANDLE'].includes(taskType) &&
    (scopes.includes('ROOM_INCIDENT') || scopes.includes('COMPLAINT_HANDLE'))
  ) {
    return true;
  }
  if (
    ['PRECHECKIN', 'OCCUPANT_UPDATE', 'PRE_ARRIVAL_CONTACT', 'ARRIVAL_SUPPORT'].includes(taskType) &&
    (scopes.includes('PRECHECKIN') || scopes.includes('OCCUPANT_UPDATE') || scopes.includes('PRE_ARRIVAL_CONTACT') || scopes.includes('ARRIVAL_SUPPORT'))
  ) {
    return true;
  }
  if (
    ['FOLIO_SETTLEMENT', 'FOLIO_ADJUSTMENT'].includes(taskType) &&
    (scopes.includes('FOLIO_SETTLEMENT') || scopes.includes('FOLIO_ADJUSTMENT'))
  ) {
    return true;
  }
  return (
    (taskType === 'SERVICE_REQUEST' && scopes.includes('SERVICE_RESPONSE')) ||
    (taskType === 'SERVICE_RESPONSE' && scopes.includes('SERVICE_REQUEST')) ||
    (scopes.includes('ALL_SERVICE_TASKS') && SERVICE_TASKS.includes(taskType))
  );
}
export async function requireActiveStaff(em: EntityManager, hotelId: string, staffId: string) {
  const [staff] = await em.query(`SELECT hs.staff_role AS staffRole FROM hotel_staff hs
    JOIN users u ON u.id = hs.staff_user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
    WHERE hs.hotel_id = ? AND hs.staff_user_id = ? AND hs.status = 'ACTIVE' AND u.role = 'EMPLOYEE'`, [hotelId, staffId]);
  if (!staff) throw new ForbiddenException('Nhân sự phải ACTIVE tại đúng khách sạn, tài khoản chưa bị khóa.');
  return staff as { staffRole: string };
}
export async function requireManager(em: EntityManager, hotelId: string, actor: {id: string; role: string}) {
  if (actor.role === 'ADMIN') {
    const [admin] = await em.query(`SELECT id FROM users WHERE id = ? AND role = 'ADMIN'
      AND status = 'ACTIVE' AND deleted_at IS NULL`, [actor.id]);
    if (admin) return;
    throw new ForbiddenException('Tài khoản quản trị không hợp lệ.');
  }
  if (actor.role !== 'EMPLOYEE' || (await requireActiveStaff(em, hotelId, actor.id)).staffRole !== 'MANAGER') {
    throw new ForbiddenException('Chỉ quản lý đúng khách sạn được điều phối.');
  }
}
export async function findCoverage(
  em: EntityManager, bookingId: string, staffId: string, taskType: string,
  at: Date, taskId?: string,
): Promise<BookingCoverageGrant | null> {
  const grants = await em.getRepository(BookingCoverageGrant).createQueryBuilder('g')
    .where('g.booking_id = :bookingId AND g.delegate_staff_id = :staffId', {bookingId, staffId})
    .andWhere("g.status = 'ACTIVE' AND g.start_at <= :at AND g.end_at > :at", {at})
    .orderBy('g.id', 'ASC').getMany();
  for (const g of grants) {
    if ('acceptedAt' in g && g.acceptedAt === null && ('acceptedBy' in g ? g.acceptedBy === null : true)) {
      continue;
    }
    if (g.scopeMode === 'BOOKING_TASKS' && OPERATION_TASKS.includes(taskType)) return g;
    if ((g.scopeMode || 'TASK_TYPES') === 'TASK_TYPES' && coverageAllows(g.allowedTaskTypes || [], taskType)) return g;
    if (g.scopeMode === 'TASK_IDS' && taskId) {
      const [scope] = await em.query(`SELECT s.task_id FROM booking_coverage_task_scopes s
        JOIN guest_work_tasks t ON t.id = s.task_id
        WHERE s.grant_id = ? AND s.task_id = ? AND t.booking_id = ? AND t.hotel_id = ? AND t.type = ?`,
        [g.id, taskId, bookingId, g.hotelId, taskType]);
      if (scope) return g;
    }
  }
  return null;
}
