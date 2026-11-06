import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  RoomUnit,
  RoomUnitHousekeepingState,
  RoomUnitOperationalStatus,
} from './entities/room-unit.entity';

export interface CreateRoomUnitDto {
  hotelId: string;
  roomTypeId: string;
  roomNumber: string;
  floor?: string;
  building?: string;
  bedConfig?: string;
  isAccessible?: boolean;
  isSmoking?: boolean;
  operationalStatus?: RoomUnitOperationalStatus;
  housekeepingState?: RoomUnitHousekeepingState;
  notes?: string;
}

@Injectable()
export class RoomUnitsService {
  constructor(
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepo: Repository<RoomUnit>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private async assertHotelStaffOrManager(
    actor: { id: string; role: string },
    hotelId: string,
    requireManager = false,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (!this.dataSource) return;
    const rows = await this.dataSource.query(
      `SELECT staff_role AS staffRole FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn này.');
    }
    if (requireManager && rows[0].staffRole !== 'MANAGER') {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền quản trị danh mục phòng vật lý.');
    }
  }

  async createRoomUnit(
    dto: CreateRoomUnitDto,
    actor: { id: string; role: string },
  ): Promise<RoomUnit> {
    const hotelId = String(dto.hotelId);
    await this.assertHotelStaffOrManager(actor, hotelId, true);

    const roomNumber = (dto.roomNumber || '').trim();
    if (!roomNumber) {
      throw new BadRequestException('Số phòng vật lý (roomNumber) không được để trống.');
    }

    const existing = await this.roomUnitRepo.findOne({
      where: { hotelId, roomNumber },
    });
    if (existing) {
      throw new ConflictException(
        `Số phòng vật lý "${roomNumber}" đã tồn tại tại khách sạn #${hotelId}.`,
      );
    }

    if (this.dataSource) {
      const roomRows = await this.dataSource.query(
        `SELECT id, hotel_id AS hotelId FROM rooms WHERE id = ? LIMIT 1`,
        [dto.roomTypeId],
      );
      if (Array.isArray(roomRows) && roomRows.length > 0) {
        if (String(roomRows[0].hotelId) !== hotelId) {
          throw new ForbiddenException('Loại phòng (roomTypeId) không thuộc khách sạn đang thao tác.');
        }
      }
    }

    const unit = this.roomUnitRepo.create({
      hotelId,
      roomTypeId: String(dto.roomTypeId),
      roomNumber,
      floor: dto.floor || null,
      building: dto.building || null,
      bedConfig: dto.bedConfig || null,
      isAccessible: Boolean(dto.isAccessible),
      isSmoking: Boolean(dto.isSmoking),
      operationalStatus: dto.operationalStatus || RoomUnitOperationalStatus.ACTIVE,
      housekeepingState: dto.housekeepingState || RoomUnitHousekeepingState.READY,
      notes: dto.notes || null,
      version: 1,
    });

    return this.roomUnitRepo.save(unit);
  }

  async listHotelRoomUnits(
    hotelId: string,
    actor: { id: string; role: string },
    filters?: {
      roomTypeId?: string;
      operationalStatus?: RoomUnitOperationalStatus;
      housekeepingState?: RoomUnitHousekeepingState;
    },
  ): Promise<RoomUnit[]> {
    await this.assertHotelStaffOrManager(actor, String(hotelId), false);
    const where: any = { hotelId: String(hotelId) };
    if (filters?.roomTypeId) where.roomTypeId = String(filters.roomTypeId);
    if (filters?.operationalStatus) where.operationalStatus = filters.operationalStatus;
    if (filters?.housekeepingState) where.housekeepingState = filters.housekeepingState;
    return this.roomUnitRepo.find({
      where,
      order: { roomNumber: 'ASC' },
    });
  }

  async updateUnitState(
    unitId: string,
    patch: {
      operationalStatus?: RoomUnitOperationalStatus;
      housekeepingState?: RoomUnitHousekeepingState;
      notes?: string;
    },
    actor: { id: string; role: string },
  ): Promise<RoomUnit> {
    const unit = await this.roomUnitRepo.findOne({ where: { id: String(unitId) } });
    if (!unit) {
      throw new NotFoundException(`Phòng vật lý #${unitId} không tồn tại.`);
    }
    await this.assertHotelStaffOrManager(actor, unit.hotelId, false);
    if (patch.operationalStatus) unit.operationalStatus = patch.operationalStatus;
    if (patch.housekeepingState) unit.housekeepingState = patch.housekeepingState;
    if (patch.notes !== undefined) unit.notes = patch.notes;
    unit.version = Number(unit.version || 1) + 1;
    return this.roomUnitRepo.save(unit);
  }
}
