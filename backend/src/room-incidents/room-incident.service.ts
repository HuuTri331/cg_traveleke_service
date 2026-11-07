import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking } from '../bookings/entities/booking.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  IncidentAction,
  RoomIncident,
  RoomIncidentResolutionType,
  RoomIncidentStatus,
} from './entities/room-incident.entity';

export interface OpenRoomIncidentInput {
  bookingId: string;
  roomTypeId: string;
  affectedUnitId?: string | null;
  incidentType?: 'ROOM_NOT_READY' | 'ROOM_AT_RISK' | 'OVERBOOKED_UNIT';
  notes?: string;
  sourceKey?: string;
}

@Injectable()
export class RoomIncidentService {
  constructor(
    @InjectRepository(RoomIncident) private readonly incidentRepo: Repository<RoomIncident>,
    @InjectRepository(IncidentAction) private readonly actionRepo: Repository<IncidentAction>,
    private readonly dataSource: DataSource,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  private async verifyOperator(bookingId: string, actor: { id: string; role: string }): Promise<Booking> {
    const booking = await this.dataSource.getRepository(Booking).findOne({ where: { id: String(bookingId) } });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);
    await assertBookingOperator(this.dataSource.manager, booking, actor, 'ROOM_INCIDENT');
    return booking;
  }

  async openIncidentOnce(input: OpenRoomIncidentInput, actor: { id: string; role: string }): Promise<RoomIncident> {
    if (!input?.bookingId || typeof input.bookingId !== 'string' || !input.bookingId.trim() || input.bookingId === 'undefined') {
      throw new BadRequestException('bookingId là bắt buộc khi mở biên bản sự cố phòng.');
    }
    if (
      !input?.roomTypeId ||
      typeof input.roomTypeId !== 'string' ||
      !input.roomTypeId.trim() ||
      input.roomTypeId === 'undefined' ||
      !/^\d+$/.test(input.roomTypeId.trim())
    ) {
      throw new BadRequestException('roomTypeId là bắt buộc và phải là mã loại phòng thương mại hợp lệ.');
    }
    const incidentType = input.incidentType || 'ROOM_NOT_READY';
    const sourceKey = (input.sourceKey || '').trim() || `${incidentType}:${input.bookingId}:${input.affectedUnitId || 'NONE'}`;
    const existing = await this.incidentRepo.findOne({ where: { sourceKey } });
    if (existing) return existing;

    const booking = await this.verifyOperator(input.bookingId, actor);
    const saved = await this.incidentRepo.save(
      this.incidentRepo.create({
        bookingId: String(booking.id),
        hotelId: String(booking.hotelId),
        roomTypeId: String(input.roomTypeId),
        affectedUnitId: input.affectedUnitId ? String(input.affectedUnitId) : null,
        incidentType,
        severity: 'HIGH',
        status: RoomIncidentStatus.OPEN,
        ownerUserId: String(actor.id),
        slaDueAt: new Date(Date.now() + 20 * 60 * 1000),
        sourceKey,
        notes: input.notes || null,
        version: 1,
      }),
    );
    await this.actionRepo.save(
      this.actionRepo.create({
        incidentId: String(saved.id),
        actionType: 'INCIDENT_OPENED',
        fromStatus: null,
        toStatus: RoomIncidentStatus.OPEN,
        actorId: String(actor.id),
        note: input.notes || null,
      }),
    );
    return saved;
  }

  async proposeOption(
    incidentId: string,
    dto: {
      resolutionType: RoomIncidentResolutionType;
      proposedUnitId?: string;
      proposedRoomTypeId?: string;
      compensationVnd?: number;
      approvedByManagerId?: string;
      approvalRequestId?: string;
      note?: string;
      commandId?: string;
    },
    actor: { id: string; role: string },
  ): Promise<RoomIncident> {
    const incident = await this.incidentRepo.findOne({ where: { id: String(incidentId) } });
    if (!incident) throw new NotFoundException(`Room incident #${incidentId} không tồn tại.`);
    await this.verifyOperator(incident.bookingId, actor);

    const requiresManager =
      dto.resolutionType === RoomIncidentResolutionType.COMPLIMENTARY_UPGRADE ||
      dto.resolutionType === RoomIncidentResolutionType.RELOCATION ||
      Number(dto.compensationVnd || 0) > 0;
    const managerId = dto.approvedByManagerId?.trim();
    if (requiresManager && !managerId && !dto.approvalRequestId && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Phương án nâng hạng miễn phí hoặc bồi thường bắt buộc có Quản lý phê duyệt.');
    }

    let verifiedManagerId: string | null = managerId || null;
    if (requiresManager && actor.role !== 'ADMIN' && typeof this.dataSource?.query === 'function') {
      if (dto.approvalRequestId) {
        const [app] = await this.dataSource.query(
          `SELECT id, hotel_id AS hotelId, booking_id AS bookingId, reviewed_by AS reviewedBy, status
           FROM approval_requests WHERE id = ? LIMIT 1`,
          [dto.approvalRequestId],
        );
        if (
          !app ||
          app.status !== 'APPROVED' ||
          String(app.hotelId) !== String(incident.hotelId) ||
          (app.bookingId && String(app.bookingId) !== String(incident.bookingId)) ||
          !app.reviewedBy
        ) {
          throw new ForbiddenException(
            'INVALID_MANAGER_APPROVAL: Quyết định phê duyệt phương án sự cố không hợp lệ hoặc không thuộc booking này.',
          );
        }
        verifiedManagerId = String(app.reviewedBy);
      } else if (managerId) {
        const mgrRows = await this.dataSource.query(
          `SELECT hs.staff_user_id AS managerId
           FROM hotel_staff hs
           INNER JOIN users u ON u.id = hs.staff_user_id
           WHERE hs.hotel_id = ? AND hs.staff_user_id = ? AND hs.staff_role = 'MANAGER'
             AND hs.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
           LIMIT 1`,
          [incident.hotelId, managerId],
        );
        if (!Array.isArray(mgrRows) || mgrRows.length === 0) {
          throw new ForbiddenException(
            'INVALID_MANAGER_APPROVAL: Người phê duyệt bồi thường/nâng hạng không phải là Quản lý (MANAGER) đang hoạt động tại khách sạn này.',
          );
        }
        verifiedManagerId = String(mgrRows[0].managerId);
      }
    }

    const prev = incident.status;
    incident.status = RoomIncidentStatus.OPTION_PROPOSED;
    incident.resolutionType = dto.resolutionType;
    incident.proposedUnitId = dto.proposedUnitId || null;
    incident.proposedRoomTypeId = dto.proposedRoomTypeId || null;
    incident.compensationVnd = Number(dto.compensationVnd || 0);
    incident.managerUserId = verifiedManagerId;
    incident.version += 1;
    const saved = await this.incidentRepo.save(incident);

    await this.actionRepo.save(
      this.actionRepo.create({
        incidentId: String(saved.id),
        actionType: 'OPTION_PROPOSED',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        payloadJson: dto as any,
        note: dto.note || null,
        commandId: dto.commandId || null,
      }),
    );
    return saved;
  }

  async resolveIncident(
    incidentId: string,
    dto: { customerAccepted: boolean; note?: string; commandId?: string },
    actor: { id: string; role: string },
  ): Promise<RoomIncident> {
    const incident = await this.incidentRepo.findOne({ where: { id: String(incidentId) } });
    if (!incident) throw new NotFoundException(`Room incident #${incidentId} không tồn tại.`);
    await this.verifyOperator(incident.bookingId, actor);

    const prev = incident.status;
    incident.status = dto.customerAccepted ? RoomIncidentStatus.RESOLVED : RoomIncidentStatus.CUSTOMER_REJECTED;
    if (dto.customerAccepted) {
      incident.customerConsentAt = new Date();
      incident.resolvedAt = new Date();
      incident.resolvedBy = String(actor.id);
    }
    incident.version += 1;
    const saved = await this.incidentRepo.save(incident);

    await this.actionRepo.save(
      this.actionRepo.create({
        incidentId: String(saved.id),
        actionType: dto.customerAccepted ? 'INCIDENT_RESOLVED' : 'CUSTOMER_REJECTED_OPTION',
        fromStatus: prev,
        toStatus: saved.status,
        actorId: String(actor.id),
        note: dto.note || null,
        commandId: dto.commandId || null,
      }),
    );
    return saved;
  }
}
