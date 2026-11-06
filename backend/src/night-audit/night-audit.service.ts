import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FolioEntry, FolioEntryKind } from '../folio/entities/folio.entity';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { Room } from '../rooms/entities/room.entity';
import { BusinessDayClosure } from './entities/business-day-closure.entity';

@Injectable()
export class NightAuditService {
  constructor(
    @InjectRepository(BusinessDayClosure)
    private readonly closureRepo: Repository<BusinessDayClosure>,
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
  ) {}

  private async assertHotelManager(actor: { id: string; role: string }, hotelId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền duyệt khóa sổ cuối ngày (Night Audit).');
    }
  }

  async previewNightAudit(
    hotelId: string,
    dateInput: string | undefined,
    actor: { id: string; role: string },
  ) {
    await this.assertHotelManager(actor, String(hotelId));
    const settings = await this.propertySettings.getHotelSettings(hotelId);
    const businessDate = dateInput
      ? this.propertyClock.toLocalDateStr(dateInput, settings.ianaTimezone)
      : this.propertyClock.resolveBusinessDate(new Date(), settings.ianaTimezone, settings.cutoffTime);

    const rooms = await this.dataSource.getRepository(Room).find({
      where: { hotelId: String(hotelId) },
    });
    const roomsAvailable = rooms.reduce((sum, r) => sum + Number(r.totalRooms || 0), 0);

    const entries = await this.dataSource.getRepository(FolioEntry).find({
      where: { hotelId: String(hotelId), businessDate },
    });

    let roomRevenueVnd = 0;
    let serviceRevenueVnd = 0;
    let verifiedPaymentsVnd = 0;
    let roomsSold = 0;

    for (const e of entries) {
      const amt = Math.round(Number(e.amountVnd || 0));
      if (e.entryKind === FolioEntryKind.ROOM_CHARGE) {
        roomRevenueVnd += amt;
        roomsSold += 1;
      } else if (e.entryKind === FolioEntryKind.SERVICE_CHARGE) {
        serviceRevenueVnd += amt;
      } else if (e.direction === 'PAYMENT') {
        verifiedPaymentsVnd += amt;
      }
    }

    const occupancyRate = roomsAvailable > 0 ? Number(((roomsSold / roomsAvailable) * 100).toFixed(2)) : 0;
    const snapshotHash = createHash('sha256')
      .update(
        JSON.stringify({
          hotelId,
          businessDate,
          roomsAvailable,
          roomsSold,
          roomRevenueVnd,
          serviceRevenueVnd,
          verifiedPaymentsVnd,
        }),
      )
      .digest('hex');

    return {
      hotelId: String(hotelId),
      businessDate,
      ianaTimezone: settings.ianaTimezone,
      roomsAvailable,
      roomsSold,
      occupancyRate,
      roomRevenueVnd,
      serviceRevenueVnd,
      verifiedPaymentsVnd,
      snapshotHash,
    };
  }

  /**
   * Closes the business day idempotently (IMP-13 / GAP-13).
   * Running again for the same date returns the already-closed snapshot without double-counting revenue.
   * Never automatically checks out in-house guests.
   */
  async closeNightAudit(
    hotelId: string,
    dateInput: string,
    commandId: string,
    actor: { id: string; role: string },
  ): Promise<BusinessDayClosure> {
    if (!commandId || !commandId.trim()) {
      throw new BadRequestException('commandId là bắt buộc khi khóa sổ cuối ngày.');
    }
    await this.assertHotelManager(actor, String(hotelId));
    const preview = await this.previewNightAudit(hotelId, dateInput, actor);

    const existing = await this.closureRepo.findOne({
      where: { hotelId: String(hotelId), businessDate: preview.businessDate },
    });
    if (existing && existing.status === 'CLOSED') {
      return existing;
    }

    const row =
      existing ||
      this.closureRepo.create({
        hotelId: String(hotelId),
        businessDate: preview.businessDate,
      });

    row.status = 'CLOSED';
    row.roomsAvailable = preview.roomsAvailable;
    row.roomsSold = preview.roomsSold;
    row.occupancyRate = preview.occupancyRate;
    row.roomRevenueVnd = preview.roomRevenueVnd;
    row.serviceRevenueVnd = preview.serviceRevenueVnd;
    row.verifiedPaymentsVnd = preview.verifiedPaymentsVnd;
    row.snapshotHash = preview.snapshotHash;
    row.closedBy = String(actor.id);
    row.closedAt = new Date();
    row.commandId = commandId.trim();
    row.version = Number(row.version || 0) + 1;

    return this.closureRepo.save(row);
  }
}
