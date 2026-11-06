import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PropertyClockService } from '../property-settings/property-clock.service';
import {
  RoomUnitStaySlot,
  RoomUnitStaySlotStatus,
} from '../room-units/entities/room-unit-stay-slot.entity';
import {
  RoomUnit,
  RoomUnitOperationalStatus,
} from '../room-units/entities/room-unit.entity';
import {
  RoomBlockStatus,
  RoomBlockType,
  RoomTypeStopSellRule,
  RoomUnitBlock,
} from './entities/room-block.entity';

export interface CreateRoomBlockDto {
  roomUnitId: string;
  blockType?: RoomBlockType;
  startDate: string;
  endExclusiveDate: string;
  reason: string;
  commandId: string;
}

@Injectable()
export class RoomBlocksService {
  constructor(
    @InjectRepository(RoomUnitBlock)
    private readonly blockRepo: Repository<RoomUnitBlock>,
    @InjectRepository(RoomTypeStopSellRule)
    private readonly stopSellRepo: Repository<RoomTypeStopSellRule>,
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepo: Repository<RoomUnit>,
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
  ) {}

  private async assertHotelManager(actor: { id: string; role: string }, hotelId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền duyệt khóa phòng bảo trì / Stop-Sell.');
    }
  }

  async previewBlock(
    hotelId: string,
    dto: Omit<CreateRoomBlockDto, 'commandId'>,
    actor: { id: string; role: string },
  ) {
    await this.assertHotelManager(actor, String(hotelId));
    const nights = this.propertyClock.enumerateStayNights(dto.startDate, dto.endExclusiveDate);
    const activeSlots = await this.dataSource.getRepository(RoomUnitStaySlot).find({
      where: {
        hotelId: String(hotelId),
        unitId: String(dto.roomUnitId),
        stayDate: In(nights),
        status: RoomUnitStaySlotStatus.ACTIVE,
      },
    });
    const impactedBookingIds = Array.from(new Set(activeSlots.map((s) => String(s.bookingId))));
    return {
      hotelId: String(hotelId),
      roomUnitId: String(dto.roomUnitId),
      nights,
      impactedBookingIds,
      hasPaidBookingsAtRisk: impactedBookingIds.length > 0,
    };
  }

  async createBlock(
    hotelId: string,
    dto: CreateRoomBlockDto,
    actor: { id: string; role: string },
  ): Promise<{ block: RoomUnitBlock; impactedBookingIds: string[] }> {
    const cmdId = (dto.commandId || '').trim();
    if (!cmdId) throw new BadRequestException('commandId là bắt buộc khi khóa phòng bảo trì.');

    const existing = await this.blockRepo.findOne({ where: { commandId: cmdId } });
    if (existing) {
      return {
        block: existing,
        impactedBookingIds: existing.impactedBookingIdsJson || [],
      };
    }

    await this.assertHotelManager(actor, String(hotelId));
    const nights = this.propertyClock.enumerateStayNights(dto.startDate, dto.endExclusiveDate);
    const unit = await this.roomUnitRepo.findOne({ where: { id: String(dto.roomUnitId) } });
    if (!unit || String(unit.hotelId) !== String(hotelId)) {
      throw new NotFoundException(`Phòng vật lý #${dto.roomUnitId} không thuộc khách sạn #${hotelId}.`);
    }

    const activeSlots = await this.dataSource.getRepository(RoomUnitStaySlot).find({
      where: {
        hotelId: String(hotelId),
        unitId: String(unit.id),
        stayDate: In(nights),
        status: RoomUnitStaySlotStatus.ACTIVE,
      },
    });
    const impactedBookingIds = Array.from(new Set(activeSlots.map((s) => String(s.bookingId))));

    const block = this.blockRepo.create({
      hotelId: String(hotelId),
      roomTypeId: String(unit.roomTypeId),
      roomUnitId: String(unit.id),
      blockType: dto.blockType || RoomBlockType.OUT_OF_ORDER,
      status: RoomBlockStatus.ACTIVE,
      startDate: nights[0],
      endExclusiveDate: dto.endExclusiveDate,
      reason: (dto.reason || 'Bảo trì phòng vật lý').trim(),
      requestedBy: String(actor.id),
      approvedBy: String(actor.id),
      impactedBookingIdsJson: impactedBookingIds,
      commandId: cmdId,
      version: 1,
    });
    const saved = await this.blockRepo.save(block);

    if ((dto.blockType || RoomBlockType.OUT_OF_ORDER) === RoomBlockType.OUT_OF_ORDER) {
      unit.operationalStatus = RoomUnitOperationalStatus.OUT_OF_ORDER;
      await this.roomUnitRepo.save(unit);
    }

    return { block: saved, impactedBookingIds };
  }

  async releaseBlock(
    blockId: string,
    actor: { id: string; role: string },
  ): Promise<RoomUnitBlock> {
    const block = await this.blockRepo.findOne({ where: { id: String(blockId) } });
    if (!block) throw new NotFoundException(`Lệnh khóa phòng #${blockId} không tồn tại.`);
    await this.assertHotelManager(actor, block.hotelId);

    if (block.status === RoomBlockStatus.RELEASED) return block;
    block.status = RoomBlockStatus.RELEASED;
    block.releasedBy = String(actor.id);
    block.releasedAt = new Date();
    block.version += 1;
    const saved = await this.blockRepo.save(block);

    const remainingActive = await this.blockRepo.count({
      where: { roomUnitId: block.roomUnitId, status: RoomBlockStatus.ACTIVE },
    });
    if (remainingActive === 0) {
      await this.roomUnitRepo.update(
        { id: block.roomUnitId },
        { operationalStatus: RoomUnitOperationalStatus.ACTIVE },
      );
    }
    return saved;
  }

  async getFreeCapacityPerStayNight(
    roomTypeId: string,
    stayDates: string[],
    totalRooms: number,
    occupiedCountByHold: number,
    em?: EntityManager,
  ): Promise<{ minFreeCapacity: number; perNightFree: Record<string, number> }> {
    const runner = em || this.dataSource.manager;
    const activeBlocks = await runner.getRepository(RoomUnitBlock).find({
      where: {
        roomTypeId: String(roomTypeId),
        status: RoomBlockStatus.ACTIVE,
        blockType: In([RoomBlockType.OUT_OF_ORDER, RoomBlockType.RENOVATION]),
      },
    });
    const stopSellRules = await runner.getRepository(RoomTypeStopSellRule).find({
      where: {
        roomTypeId: String(roomTypeId),
        status: 'ACTIVE',
      },
    });

    const perNightFree: Record<string, number> = {};
    let minFreeCapacity = totalRooms;

    for (const night of stayDates) {
      const hasStopSell = stopSellRules.some(
        (r) => r.stopSell && r.startDate <= night && night < r.endExclusiveDate,
      );
      if (hasStopSell) {
        perNightFree[night] = 0;
        minFreeCapacity = 0;
        continue;
      }

      const blockedUnitsOnNight = new Set(
        activeBlocks
          .filter((b) => b.startDate <= night && night < b.endExclusiveDate)
          .map((b) => String(b.roomUnitId)),
      );
      const extraRuleBlocks = stopSellRules
        .filter((r) => !r.stopSell && r.startDate <= night && night < r.endExclusiveDate)
        .reduce((sum, r) => sum + Number(r.blockedCount || 0), 0);

      const freeOnNight = Math.max(
        0,
        totalRooms - occupiedCountByHold - blockedUnitsOnNight.size - extraRuleBlocks,
      );
      perNightFree[night] = freeOnNight;
      if (freeOnNight < minFreeCapacity) {
        minFreeCapacity = freeOnNight;
      }
    }

    return { minFreeCapacity, perNightFree };
  }
}
