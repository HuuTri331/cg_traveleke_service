import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { coverageAllows, OPERATION_TASKS } from '../../booking-coverage/coverage-policy';
import { Booking } from '../entities/booking.entity';

export type StaffActor = { id: string; role: 'EMPLOYEE' | 'ADMIN' | string };
export type BookingAction =
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'ROOM_ASSIGN'
  | 'ASSIGN_ROOM'
  | 'MOVE_ROOM'
  | 'ROOM_MOVE'
  | 'ROOM_INCIDENT'
  | 'MESSAGE'
  | 'PRE_ARRIVAL_CONTACT'
  | 'PRECHECKIN'
  | 'OCCUPANT_UPDATE'
  | 'SERVICE_REQUEST'
  | 'SERVICE_RESPONSE'
  | 'AMENDMENT_REQUEST'
  | 'AMEND_BOOKING'
  | 'ARRIVAL_SUPPORT'
  | 'FOLIO_SETTLEMENT'
  | 'FOLIO_ADJUSTMENT'
  | 'STAY_TIME_REQUEST'
  | 'STAY_TIME_EXTENSION'
  | 'COMPLAINT_HANDLE'
  | 'WRITE_BOOKING_STATUS';

@Injectable()
export class BookingWritePolicy {
  async assertCanWriteLocked(
    em: EntityManager,
    booking: Booking,
    actor: StaffActor,
    action: BookingAction,
    now = new Date(),
    options?: { allowAdminOverrideWithReason?: string; taskId?: string },
  ): Promise<{ executorId: string; coverageGrantId: string | null }> {
    if (actor.role === 'ADMIN') {
      if (!options?.allowAdminOverrideWithReason?.trim()) {
        throw new ForbiddenException('ADMIN phải dùng command override có audit');
      }
      return { executorId: String(actor.id), coverageGrantId: null };
    }

    const [staff] = await em.query(
      `SELECT hs.id, hs.staff_role AS staffRole
       FROM hotel_staff hs
       JOIN users u ON u.id = hs.staff_user_id
       WHERE hs.hotel_id = ? AND hs.staff_user_id = ? AND hs.status = 'ACTIVE'
         AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
      [booking.hotelId, actor.id],
    );
    if (!staff) {
      throw new ForbiddenException('STAFF_NOT_ACTIVE_AT_PROPERTY');
    }

    const activeGrants = await em.query(
      `SELECT g.id,
              g.delegate_staff_id AS delegateId,
              g.principal_staff_id AS principalId,
              g.scope_mode AS scopeMode,
              g.allowed_task_types AS allowedTaskTypes,
              g.accepted_at AS acceptedAt
       FROM booking_coverage_grants g
       WHERE g.booking_id = ? AND g.status = 'ACTIVE'
         AND g.accepted_at IS NOT NULL AND g.start_at <= ? AND g.end_at > ?
       ORDER BY g.id ASC FOR UPDATE`,
      [booking.id, now, now],
    );

    if (Array.isArray(activeGrants) && activeGrants.length > 0) {
      for (const grant of activeGrants) {
        const coversAction = await this.grantCoversAction(
          em,
          booking,
          grant,
          action,
          options?.taskId,
        );
        if (coversAction) {
          const delegateId = String(grant.delegateId ?? grant.delegateStaffId);
          if (delegateId !== String(actor.id)) {
            throw new ForbiddenException('COVERAGE_ACTIVE_ONLY_DELEGATE_CAN_WRITE');
          }
          await this.assertOnDutyAndNotAbsent(em, String(booking.hotelId), String(actor.id), now);
          return { executorId: String(actor.id), coverageGrantId: String(grant.id) };
        }
      }
    }

    if (String(booking.handledBy) !== String(actor.id)) {
      throw new ForbiddenException('NOT_EFFECTIVE_BOOKING_HANDLER');
    }

    await this.assertOnDutyAndNotAbsent(em, String(booking.hotelId), String(actor.id), now);
    return { executorId: String(actor.id), coverageGrantId: null };
  }

  private async grantCoversAction(
    em: EntityManager,
    booking: Booking,
    grant: any,
    action: BookingAction,
    taskId?: string,
  ): Promise<boolean> {
    const scopeMode = grant.scopeMode || 'TASK_TYPES';
    if (scopeMode === 'BOOKING_TASKS') {
      return OPERATION_TASKS.includes(action);
    }
    if (scopeMode === 'TASK_IDS' && taskId) {
      const [scope] = await em.query(
        `SELECT s.task_id FROM booking_coverage_task_scopes s
         JOIN guest_work_tasks t ON t.id = s.task_id
         WHERE s.grant_id = ? AND s.task_id = ? AND t.booking_id = ? AND t.hotel_id = ?`,
        [grant.id, taskId, booking.id, booking.hotelId],
      );
      return Boolean(scope);
    }
    return this.coverageScopesInclude(grant.allowedTaskTypes, action);
  }

  coverageScopesInclude(raw: unknown, action: string): boolean {
    let types: string[] = [];
    try {
      types = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]'));
    } catch {
      return false;
    }
    return coverageAllows(types, action) || types.includes('BOOKING_TASKS');
  }

  async assertOnDutyAndNotAbsent(
    em: EntityManager,
    hotelId: string,
    staffId: string,
    now: Date,
  ): Promise<void> {
    const [absence] = await em.query(
      `SELECT id FROM staff_availability_blocks
       WHERE hotel_id = ? AND staff_user_id = ?
         AND active = 1 AND start_at <= ? AND end_at > ? LIMIT 1`,
      [hotelId, staffId, now, now],
    );
    if (absence) {
      throw new ForbiddenException('STAFF_APPROVED_ABSENCE');
    }

    const [shift] = await em.query(
      `SELECT id FROM staff_shifts
       WHERE hotel_id = ? AND staff_user_id = ?
         AND status = 'ACTIVE' AND planned_start_at <= ? AND planned_end_at > ?
         AND start_time IS NOT NULL AND (end_time IS NULL OR end_time > ?) LIMIT 1`,
      [hotelId, staffId, now, now, now],
    );
    if (!shift) {
      throw new ConflictException('STAFF_NOT_ON_DUTY');
    }
  }
}
