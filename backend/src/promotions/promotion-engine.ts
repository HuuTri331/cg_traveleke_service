import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { NightlyPriceLine } from './entities/booking-price-quote.entity';
import {
  ChargeComponentType,
  PromotionCampaign,
  PromotionDiscountType,
  PromotionTargetScope,
} from './entities/promotion-campaign.entity';

export function toLocalHotelDate(input: Date | string, timeZone = 'Asia/Ho_Chi_Minh'): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Ngày nhận hoặc trả phòng không hợp lệ.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * INV-P02: Enumerate stay nights in half-open interval [checkInLocalDate, checkOutLocalDate).
 * Checkout date is never counted as a stay night.
 */
export function enumerateStayNights(checkInLocalDate: string, checkOutLocalDate: string): string[] {
  if (checkOutLocalDate <= checkInLocalDate) {
    throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
  }
  const nights: string[] = [];
  let cursor = checkInLocalDate;
  while (cursor < checkOutLocalDate) {
    nights.push(cursor);
    cursor = addDaysToDateStr(cursor, 1);
    if (nights.length > 366) {
      throw new BadRequestException('Kỳ lưu trú vượt quá số đêm tối đa cho phép.');
    }
  }
  return nights;
}

function effectiveRoomTargets(c: Partial<PromotionCampaign>): { all: boolean; ids: Set<string> } {
  if (c.targetScope === PromotionTargetScope.ALL_ROOMS) return { all: true, ids: new Set() };
  const roomIds = [
    ...(Array.isArray(c.targetRoomIds) ? c.targetRoomIds : []),
    ...(Array.isArray(c.packageConfig?.allocatedRoomIds) ? c.packageConfig!.allocatedRoomIds! : []),
  ].map(String);
  return { all: false, ids: new Set(roomIds) };
}

function effectiveServiceTargets(c: Partial<PromotionCampaign>): { all: boolean; ids: Set<string> } {
  if (c.targetScope === PromotionTargetScope.ALL_SERVICES) return { all: true, ids: new Set() };
  const svcIds = (Array.isArray(c.targetServiceIds) ? c.targetServiceIds : []).map(String);
  return { all: false, ids: new Set(svcIds) };
}

function affectsRoomCharge(c: Partial<PromotionCampaign>): boolean {
  if (c.chargeComponentType === ChargeComponentType.ROOM_NIGHT) return true;
  if (
    c.chargeComponentType === ChargeComponentType.PACKAGE_COMPONENT &&
    (Number(c.packageConfig?.roomPriceDiscountPercent || 0) > 0 || Number(c.discountValue || 0) > 0)
  ) {
    return true;
  }
  return false;
}

export interface CampaignConflictItem {
  conflictingCampaignId: string;
  conflictingCode: string;
  conflictingName: string;
  reason: string;
}

/**
 * Section 7 / INV-P05: Detect overlapping campaigns on the same charge component, target and time slice.
 */
export function detectCampaignConflicts(
  candidate: Partial<PromotionCampaign>,
  existingList: PromotionCampaign[],
): CampaignConflictItem[] {
  const conflicts: CampaignConflictItem[] = [];
  const startA = String(candidate.stayStartDate || '');
  const endA = String(candidate.stayEndExclusiveDate || '');

  for (const ex of existingList) {
    if (candidate.id && String(ex.id) === String(candidate.id)) continue;
    if (String(ex.hotelId) !== String(candidate.hotelId)) continue;
    if (!(startA < ex.stayEndExclusiveDate && endA > ex.stayStartDate)) continue;
    if (
      candidate.combinabilityPolicy === 'COMBINABLE_INDEPENDENT' &&
      ex.combinabilityPolicy === 'COMBINABLE_INDEPENDENT'
    ) {
      continue;
    }

    if (affectsRoomCharge(candidate) && affectsRoomCharge(ex)) {
      const tA = effectiveRoomTargets(candidate);
      const tB = effectiveRoomTargets(ex);
      const roomOverlap =
        tA.all || tB.all || [...tA.ids].some((id) => tB.ids.has(id));
      if (roomOverlap) {
        conflicts.push({
          conflictingCampaignId: String(ex.id),
          conflictingCode: ex.code,
          conflictingName: ex.name,
          reason: `Trùng dòng tiền phòng (ROOM_NIGHT) với chương trình "${ex.name}" (${ex.code}) trong khoảng [${ex.stayStartDate}, ${ex.stayEndExclusiveDate})`,
        });
      }
      continue;
    }

    if (
      candidate.chargeComponentType === ChargeComponentType.SERVICE_ITEM &&
      ex.chargeComponentType === ChargeComponentType.SERVICE_ITEM
    ) {
      const sA = effectiveServiceTargets(candidate);
      const sB = effectiveServiceTargets(ex);
      const svcOverlap =
        sA.all || sB.all || [...sA.ids].some((id) => sB.ids.has(id));
      if (!svcOverlap) continue;

      const hStartA = candidate.serviceStartHour ?? 0;
      const hEndA = candidate.serviceEndHour ?? 24;
      const hStartB = ex.serviceStartHour ?? 0;
      const hEndB = ex.serviceEndHour ?? 24;
      // Half-open hour slice [startHour, endHour): [14,17) and [17,19) do NOT overlap (B16)
      if (hStartA < hEndB && hEndA > hStartB) {
        conflicts.push({
          conflictingCampaignId: String(ex.id),
          conflictingCode: ex.code,
          conflictingName: ex.name,
          reason: `Trùng dịch vụ và khung giờ [${hStartA}:00, ${hEndA}:00) với chương trình "${ex.name}" (${ex.code})`,
        });
      }
    }
  }
  return conflicts;
}

export function hasRemainingCampaignBudget(c: PromotionCampaign, requiredAmount = 1): boolean {
  if (c.maxRedemptions !== null && c.maxRedemptions !== undefined) {
    if (Number(c.redemptionsCount || 0) >= Number(c.maxRedemptions)) return false;
  }
  if (c.budgetTotal === null || c.budgetTotal === undefined) return true;
  const available =
    Number(c.budgetTotal) -
    Number(c.budgetReserved || 0) -
    Number(c.budgetConsumed || 0) +
    Number(c.budgetReversed || 0);
  return available >= requiredAmount && available > 0;
}

export function computeSingleRoomNightDiscount(
  baseRate: number,
  campaign: PromotionCampaign,
): number {
  const floor = Math.max(0, Number(campaign.floorPrice || 0));
  const maxPossibleReduction = Math.max(0, baseRate - floor);
  let rawDiscount = 0;

  if (campaign.discountType === PromotionDiscountType.PERCENT) {
    rawDiscount = Math.round((baseRate * Number(campaign.discountValue || 0)) / 100);
  } else if (
    campaign.discountType === PromotionDiscountType.FIXED_AMOUNT ||
    campaign.discountType === PromotionDiscountType.SERVICE_CREDIT
  ) {
    rawDiscount = Math.round(Number(campaign.discountValue || 0));
  } else if (campaign.discountType === PromotionDiscountType.PACKAGE_FIXED) {
    const pct = Number(campaign.packageConfig?.roomPriceDiscountPercent || 0);
    rawDiscount = pct > 0 ? Math.round((baseRate * pct) / 100) : Math.round(Number(campaign.discountValue || 0));
  }

  if (campaign.maxDiscountPerNight !== null && campaign.maxDiscountPerNight !== undefined) {
    rawDiscount = Math.min(rawDiscount, Math.round(Number(campaign.maxDiscountPerNight)));
  }

  return Math.max(0, Math.min(rawDiscount, maxPossibleReduction));
}

export function computeNightlyQuote(params: {
  hotelId: string;
  roomId: string;
  baseRatePerNight: number;
  roomQuantity: number;
  totalGuests: number;
  checkInAt: Date | string;
  checkOutAt: Date | string;
  hotelTimezone?: string;
  activeCampaigns: PromotionCampaign[];
  forExistingBooking?: boolean;
}) {
  const tz = params.hotelTimezone || 'Asia/Ho_Chi_Minh';
  const checkInLocalDate = toLocalHotelDate(params.checkInAt, tz);
  const checkOutLocalDate = toLocalHotelDate(params.checkOutAt, tz);
  const nights = enumerateStayNights(checkInLocalDate, checkOutLocalDate);
  const qty = Math.max(1, Number(params.roomQuantity || 1));
  const guests = Math.max(1, Number(params.totalGuests || 1));
  const baseRate = Math.round(Number(params.baseRatePerNight));
  const baseTotal = baseRate * qty * nights.length;

  const eligibleCampaigns = params.activeCampaigns.filter((c) => {
    if (String(c.hotelId) !== String(params.hotelId)) return false;
    if (c.status !== 'ACTIVE') return false;
    if (params.forExistingBooking && !c.existingBookingsEligible) return false;
    if (nights.length < Number(c.minNights || 1)) return false;
    if (qty < Number(c.minRooms || 1)) return false;
    if (guests < Number(c.minGuests || 1)) return false;
    if (baseTotal < Number(c.minOrderAmount || 0)) return false;
    if (!affectsRoomCharge(c) && c.discountType !== PromotionDiscountType.SERVICE_CREDIT) return false;
    const t = effectiveRoomTargets(c);
    if (!t.all && !t.ids.has(String(params.roomId))) return false;
    return hasRemainingCampaignBudget(c, 1);
  });

  const campaignUsedTotals = new Map<string, number>();
  const nightlyLines: NightlyPriceLine[] = [];

  for (const nightDate of nights) {
    const baseSubtotal = baseRate * qty;
    let chosen: PromotionCampaign | null = null;
    let bestDiscount = 0;

    for (const c of eligibleCampaigns) {
      if (!(nightDate >= c.stayStartDate && nightDate < c.stayEndExclusiveDate)) continue;
      const perRoomDisc = computeSingleRoomNightDiscount(baseRate, c);
      let nightDisc = perRoomDisc * qty;

      const alreadyUsed = campaignUsedTotals.get(String(c.id)) || 0;
      if (c.maxDiscountPerBooking !== null && c.maxDiscountPerBooking !== undefined) {
        const remainingCap = Math.max(0, Math.round(Number(c.maxDiscountPerBooking)) - alreadyUsed);
        nightDisc = Math.min(nightDisc, remainingCap);
      }
      if (c.budgetTotal !== null && c.budgetTotal !== undefined) {
        const availBudget =
          Math.round(Number(c.budgetTotal)) -
          Math.round(Number(c.budgetReserved || 0)) -
          Math.round(Number(c.budgetConsumed || 0)) +
          Math.round(Number(c.budgetReversed || 0)) -
          alreadyUsed;
        nightDisc = Math.min(nightDisc, Math.max(0, availBudget));
      }

      if (nightDisc > bestDiscount) {
        bestDiscount = nightDisc;
        chosen = c;
      }
    }

    if (chosen && bestDiscount > 0) {
      campaignUsedTotals.set(
        String(chosen.id),
        (campaignUsedTotals.get(String(chosen.id)) || 0) + bestDiscount,
      );
    }

    const discountOnRoom =
      chosen && chosen.benefitKind === 'ROOM_PRICE_ADJUSTMENT' ? bestDiscount : 0;
    nightlyLines.push({
      nightDate,
      roomId: String(params.roomId),
      quantity: qty,
      baseRatePerRoom: baseRate,
      baseSubtotal,
      appliedCampaignId: chosen ? String(chosen.id) : null,
      appliedCampaignCode: chosen ? chosen.code : null,
      appliedCampaignVersion: chosen ? chosen.version : null,
      discountAmount: bestDiscount,
      payableSubtotal: Math.max(0, baseSubtotal - discountOnRoom),
    });
  }

  const discountTotal = nightlyLines.reduce((sum, l) => sum + l.discountAmount, 0);
  const payableTotal = nightlyLines.reduce((sum, l) => sum + l.payableSubtotal, 0);
  const appliedCampaigns = [...campaignUsedTotals.entries()].map(([cid, amount]) => {
    const camp = eligibleCampaigns.find((c) => String(c.id) === cid)!;
    return {
      campaignId: cid,
      code: camp.code,
      name: camp.name,
      version: camp.version,
      benefitKind: camp.benefitKind,
      discountAmount: amount,
    };
  });

  const priceHash = createHash('sha256')
    .update(
      JSON.stringify({
        hotelId: params.hotelId,
        roomId: params.roomId,
        qty,
        checkInLocalDate,
        checkOutLocalDate,
        baseTotal,
        discountTotal,
        payableTotal,
        nightlyLines,
      }),
    )
    .digest('hex');

  return {
    checkInLocalDate,
    checkOutLocalDate,
    nightsCount: nights.length,
    baseTotal,
    discountTotal,
    payableTotal,
    priceHash,
    nightlyLines,
    appliedCampaigns,
  };
}
