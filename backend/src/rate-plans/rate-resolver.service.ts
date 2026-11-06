import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Room } from '../rooms/entities/room.entity';
import { RateCalendar, RatePlan } from './entities/rate-plan.entity';

export interface ResolvedNightRate {
  stayDate: string;
  baseRateVnd: number;
  extraGuestSurchargeVnd: number;
  effectiveNightRateVnd: number;
  ratePlanId: string | null;
  ratePlanVersion: number;
  seasonLabel: string | null;
}

@Injectable()
export class RateResolverService {
  constructor(
    @InjectRepository(RatePlan) private readonly ratePlanRepo: Repository<RatePlan>,
    @InjectRepository(RateCalendar) private readonly calendarRepo: Repository<RateCalendar>,
    private readonly dataSource: DataSource,
  ) {}

  private async assertHotelManager(actor: { id: string; role: string }, hotelId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn mới có quyền cấu hình Rate Plan.');
    }
  }

  async createRatePlan(hotelId: string, dto: Partial<RatePlan>, actor: { id: string; role: string }): Promise<RatePlan> {
    await this.assertHotelManager(actor, String(hotelId));
    if (!dto.roomTypeId || !dto.code || !dto.name) {
      throw new BadRequestException('roomTypeId, code và name là bắt buộc khi tạo Rate Plan.');
    }
    const plan = this.ratePlanRepo.create({
      hotelId: String(hotelId),
      roomTypeId: String(dto.roomTypeId),
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
      mealPlan: dto.mealPlan || 'ROOM_ONLY',
      isRefundable: dto.isRefundable ?? true,
      cancellationPolicyId: dto.cancellationPolicyId ? String(dto.cancellationPolicyId) : null,
      baseOccupancy: Number(dto.baseOccupancy ?? 2),
      extraAdultFeeVnd: Number(dto.extraAdultFeeVnd ?? 0),
      extraChildFeeVnd: Number(dto.extraChildFeeVnd ?? 0),
      floorPriceVnd: Number(dto.floorPriceVnd ?? 100000),
      ceilingPriceVnd: dto.ceilingPriceVnd !== undefined && dto.ceilingPriceVnd !== null ? Number(dto.ceilingPriceVnd) : null,
      priority: Number(dto.priority ?? 100),
      status: 'ACTIVE',
      version: 1,
    });
    return this.ratePlanRepo.save(plan);
  }

  async upsertCalendarEntries(
    ratePlanId: string,
    entries: Array<{ stayDate: string; baseVnd: number; adjustmentVnd?: number; minimumNights?: number; closed?: boolean; seasonLabel?: string }>,
    actor: { id: string; role: string },
  ): Promise<RateCalendar[]> {
    const plan = await this.ratePlanRepo.findOne({ where: { id: String(ratePlanId) } });
    if (!plan) throw new NotFoundException(`Rate plan #${ratePlanId} không tồn tại.`);
    await this.assertHotelManager(actor, plan.hotelId);

    const saved: RateCalendar[] = [];
    for (const item of entries) {
      let row = await this.calendarRepo.findOne({ where: { ratePlanId: String(plan.id), stayDate: item.stayDate } });
      if (!row) {
        row = this.calendarRepo.create({
          ratePlanId: String(plan.id),
          hotelId: plan.hotelId,
          roomTypeId: plan.roomTypeId,
          stayDate: item.stayDate,
          baseVnd: Number(item.baseVnd),
          adjustmentVnd: Number(item.adjustmentVnd ?? 0),
          minimumNights: Number(item.minimumNights ?? 1),
          closed: Boolean(item.closed),
          seasonLabel: item.seasonLabel || null,
          version: 1,
        });
      } else {
        row.baseVnd = Number(item.baseVnd);
        row.adjustmentVnd = Number(item.adjustmentVnd ?? 0);
        row.minimumNights = Number(item.minimumNights ?? 1);
        row.closed = Boolean(item.closed);
        row.seasonLabel = item.seasonLabel || row.seasonLabel;
        row.version += 1;
      }
      saved.push(await this.calendarRepo.save(row));
    }
    plan.version += 1;
    await this.ratePlanRepo.save(plan);
    return saved;
  }

  async resolveStayRates(params: {
    hotelId: string;
    roomTypeId: string;
    stayDates: string[];
    ratePlanId?: string | null;
    adults?: number;
    children?: number;
    fallbackRoomPriceVnd?: number;
  }): Promise<{ nights: ResolvedNightRate[]; totalBaseVnd: number; rateHash: string }> {
    let plan: RatePlan | null = null;
    if (params.ratePlanId) {
      plan = await this.ratePlanRepo.findOne({
        where: { id: String(params.ratePlanId), hotelId: String(params.hotelId), status: 'ACTIVE' },
      });
      if (!plan) throw new NotFoundException(`Rate plan #${params.ratePlanId} không tồn tại.`);
    }

    let fallbackPrice = Number(params.fallbackRoomPriceVnd ?? 0);
    if (!fallbackPrice) {
      const room = await this.dataSource.getRepository(Room).findOne({ where: { id: String(params.roomTypeId) } });
      fallbackPrice = Number(room?.pricePerNight ?? 500000);
    }

    const calendarRows = plan
      ? await this.calendarRepo.find({ where: { ratePlanId: String(plan.id), stayDate: In(params.stayDates) } })
      : [];
    const calMap = new Map(calendarRows.map((c) => [c.stayDate, c]));

    const extraAdults = plan ? Math.max(0, Number(params.adults ?? 2) - Number(plan.baseOccupancy || 2)) : 0;
    const extraChildren = plan ? Math.max(0, Number(params.children ?? 0)) : 0;
    const extraGuestFee = plan
      ? extraAdults * Number(plan.extraAdultFeeVnd || 0) + extraChildren * Number(plan.extraChildFeeVnd || 0)
      : 0;

    const nights: ResolvedNightRate[] = [];
    for (const dateStr of params.stayDates) {
      const cal = calMap.get(dateStr);
      if (cal?.closed) {
        throw new ConflictException(`RATE_PLAN_CLOSED_ON_DATE: Gói giá đã đóng bán vào đêm ${dateStr}.`);
      }
      if (cal && Number(cal.minimumNights || 1) > params.stayDates.length) {
        throw new BadRequestException(`MINIMUM_STAY_NOT_MET: Đêm ${dateStr} yêu cầu tối thiểu ${cal.minimumNights} đêm.`);
      }
      let rawBase = cal ? Math.round(Number(cal.baseVnd) + Number(cal.adjustmentVnd || 0)) : Math.round(fallbackPrice);
      if (plan) {
        rawBase = Math.max(Number(plan.floorPriceVnd || 0), rawBase);
        if (plan.ceilingPriceVnd !== null && plan.ceilingPriceVnd !== undefined) {
          rawBase = Math.min(Number(plan.ceilingPriceVnd), rawBase);
        }
      }
      const effectiveNightRateVnd = Math.round(rawBase + extraGuestFee);
      nights.push({
        stayDate: dateStr,
        baseRateVnd: rawBase,
        extraGuestSurchargeVnd: Math.round(extraGuestFee),
        effectiveNightRateVnd,
        ratePlanId: plan ? String(plan.id) : null,
        ratePlanVersion: plan ? Number(plan.version) : 1,
        seasonLabel: cal?.seasonLabel || null,
      });
    }

    const totalBaseVnd = nights.reduce((s, n) => s + n.effectiveNightRateVnd, 0);
    const rateHash = createHash('sha256')
      .update(JSON.stringify({ roomTypeId: params.roomTypeId, nights, totalBaseVnd }))
      .digest('hex');

    return { nights, totalBaseVnd, rateHash };
  }
}
