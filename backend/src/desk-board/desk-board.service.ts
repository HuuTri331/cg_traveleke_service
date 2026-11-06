import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { RoomIncident, RoomIncidentStatus } from '../room-incidents/entities/room-incident.entity';
import { RoomUnitAllocation, RoomUnitAllocationStatus } from '../room-units/entities/room-unit-allocation.entity';
import { RoomUnit, RoomUnitHousekeepingState } from '../room-units/entities/room-unit.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';

@Injectable()
export class DeskBoardService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  private async getStaffRole(actor: { id: string; role: string }, hotelId: string): Promise<'ADMIN' | 'MANAGER' | 'STAFF'> {
    if (actor.role === 'ADMIN') return 'ADMIN';
    const rows = await this.dataSource.query(
      `SELECT staff_role AS staffRole FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn này.');
    }
    return rows[0].staffRole === 'MANAGER' ? 'MANAGER' : 'STAFF';
  }

  async getTodayBoard(hotelId: string, businessDateInput: string | undefined, actor: { id: string; role: string }) {
    const staffRole = await this.getStaffRole(actor, String(hotelId));
    const settings = await this.propertySettings.getHotelSettings(hotelId);
    const businessDate = businessDateInput
      ? this.propertyClock.toLocalDateStr(businessDateInput, settings.ianaTimezone)
      : this.propertyClock.resolveBusinessDate(new Date(), settings.ianaTimezone, settings.cutoffTime);

    const bookings = await this.dataSource.getRepository(Booking).find({
      where: {
        hotelId: String(hotelId),
        status: In([BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN]),
      },
      order: { checkInAt: 'ASC' },
    });

    const bookingIds = bookings.map((b) => String(b.id));
    const allocations = bookingIds.length > 0
      ? await this.dataSource.getRepository(RoomUnitAllocation).find({
          where: { bookingId: In(bookingIds), status: In([RoomUnitAllocationStatus.ASSIGNED, RoomUnitAllocationStatus.CHECKED_IN]) },
        })
      : [];
    const unitIds = Array.from(new Set(allocations.map((a) => String(a.roomUnitId))));
    const units = unitIds.length > 0 ? await this.dataSource.getRepository(RoomUnit).find({ where: { id: In(unitIds) } }) : [];
    const unitMap = new Map(units.map((u) => [String(u.id), u]));

    const openIncidents = bookingIds.length > 0
      ? await this.dataSource.getRepository(RoomIncident).find({
          where: { bookingId: In(bookingIds), status: In([RoomIncidentStatus.OPEN, RoomIncidentStatus.ACKNOWLEDGED, RoomIncidentStatus.OPTION_PROPOSED]) },
        })
      : [];
    const incidentByBooking = new Map(openIncidents.map((inc) => [String(inc.bookingId), inc]));

    return this.classifyTodayCards(bookings, allocations, unitMap, incidentByBooking, settings, businessDate, staffRole, actor.id);
  }

  private classifyTodayCards(
    bookings: Booking[],
    allocations: RoomUnitAllocation[],
    unitMap: Map<string, RoomUnit>,
    incidentByBooking: Map<string, RoomIncident>,
    settings: { hotelId: string; ianaTimezone: string },
    businessDate: string,
    staffRole: 'ADMIN' | 'MANAGER' | 'STAFF',
    actorId: string,
  ) {
    const arrivals: any[] = [];
    const inHouse: any[] = [];
    const departures: any[] = [];
    const exceptions: any[] = [];

    for (const b of bookings) {
      const checkInLocal = this.propertyClock.toLocalDateStr(b.checkInAt, settings.ianaTimezone);
      const checkOutLocal = this.propertyClock.toLocalDateStr(b.checkOutAt, settings.ianaTimezone);
      const effectiveExecutorId = b.handledBy ? String(b.handledBy) : null;
      const canOperate =
        staffRole === 'ADMIN' ||
        staffRole === 'MANAGER' ||
        (effectiveExecutorId !== null && String(effectiveExecutorId) === String(actorId));
      if (staffRole === 'STAFF' && !canOperate) continue;

      const bUnits = allocations
        .filter((a) => String(a.bookingId) === String(b.id))
        .map((a) => unitMap.get(String(a.roomUnitId)))
        .filter(Boolean) as RoomUnit[];
      const roomReadiness =
        bUnits.length === 0
          ? 'UNASSIGNED'
          : bUnits.every((u) => u.housekeepingState === RoomUnitHousekeepingState.READY)
          ? 'READY'
          : 'NOT_READY';

      const card = {
        bookingId: String(b.id),
        hotelId: String(b.hotelId),
        status: b.status,
        checkInDate: checkInLocal,
        checkOutDate: checkOutLocal,
        currentEffectiveExecutorId: effectiveExecutorId,
        assignedRoomNumbers: bUnits.map((u) => u.roomNumber),
        roomReadiness,
        hasOpenIncident: incidentByBooking.has(String(b.id)),
        allowedActions: {
          canAssignRoom: canOperate && b.status !== BookingStatus.CHECKED_IN,
          canCheckIn: canOperate && b.status !== BookingStatus.CHECKED_IN && roomReadiness === 'READY',
          canCheckOut: canOperate && b.status === BookingStatus.CHECKED_IN,
          canOpenIncident: canOperate && roomReadiness !== 'READY',
        },
      };

      if (checkInLocal === businessDate && b.status !== BookingStatus.CHECKED_IN) {
        arrivals.push(card);
        if (roomReadiness !== 'READY' || !effectiveExecutorId) {
          exceptions.push({ ...card, exceptionReason: !effectiveExecutorId ? 'UNASSIGNED_OWNER' : 'ROOM_NOT_READY' });
        }
      } else if (checkOutLocal === businessDate && b.status === BookingStatus.CHECKED_IN) {
        departures.push(card);
      } else if (b.status === BookingStatus.CHECKED_IN) {
        inHouse.push(card);
      }
    }

    return {
      hotelId: String(settings.hotelId),
      businessDate,
      ianaTimezone: settings.ianaTimezone,
      arrivals,
      inHouse,
      departures,
      exceptions,
    };
  }
}
