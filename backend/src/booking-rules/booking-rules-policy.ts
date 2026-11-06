import { BadRequestException, ConflictException } from '@nestjs/common';

export interface DailyBookingRestriction {
  stayDate: string;
  minNights?: number;
  maxNights?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
  cutoffAt?: string | null; // HH:mm:ss in property timezone
  advanceMinHours?: number;
  advanceMaxDays?: number;
}

export interface StayRestrictionEvaluationResult {
  allowed: boolean;
  violations: string[];
}

/**
 * Pure policy evaluation for IMP-09 / GAP-09:
 * - Closed-To-Arrival (CTA) only blocks arrival on stayNights[0], allowing stay-through on intermediate nights!
 * - Closed-To-Departure (CTD) only blocks departure on checkOutDate.
 * - Stop-sell blocks any stay night in [checkInDate, checkOutDate).
 * - Min/Max stay nights, same-day cutoff time, and advance booking window.
 */
export function evaluateStayRestrictions(params: {
  stayNights: string[];
  checkOutDate: string;
  restrictionsByDate: Map<string, DailyBookingRestriction>;
  bookingLocalDate?: string;
  bookingLocalTime?: string;
  hoursBeforeCheckIn?: number;
}): StayRestrictionEvaluationResult {
  const violations: string[] = [];
  const { stayNights, checkOutDate, restrictionsByDate } = params;
  if (!stayNights || stayNights.length === 0) {
    return { allowed: false, violations: ['EMPTY_STAY_NIGHTS'] };
  }

  const arrivalDate = stayNights[0];
  const nightCount = stayNights.length;
  const arrivalRule = restrictionsByDate.get(arrivalDate);

  if (arrivalRule) {
    if (arrivalRule.closedToArrival) {
      violations.push(`CLOSED_TO_ARRIVAL:${arrivalDate}`);
    }
    if (arrivalRule.minNights && nightCount < arrivalRule.minNights) {
      violations.push(`MIN_STAY_VIOLATION:required=${arrivalRule.minNights},actual=${nightCount}`);
    }
    if (arrivalRule.maxNights && nightCount > arrivalRule.maxNights) {
      violations.push(`MAX_STAY_VIOLATION:max=${arrivalRule.maxNights},actual=${nightCount}`);
    }
    if (
      params.bookingLocalDate === arrivalDate &&
      arrivalRule.cutoffAt &&
      params.bookingLocalTime &&
      params.bookingLocalTime > arrivalRule.cutoffAt
    ) {
      violations.push(`SAME_DAY_CUTOFF_PASSED:${arrivalRule.cutoffAt}`);
    }
    if (
      arrivalRule.advanceMinHours &&
      params.hoursBeforeCheckIn !== undefined &&
      params.hoursBeforeCheckIn < arrivalRule.advanceMinHours
    ) {
      violations.push(`ADVANCE_MIN_HOURS_VIOLATION:${arrivalRule.advanceMinHours}`);
    }
    if (
      arrivalRule.advanceMaxDays &&
      params.hoursBeforeCheckIn !== undefined &&
      params.hoursBeforeCheckIn > arrivalRule.advanceMaxDays * 24
    ) {
      violations.push(`ADVANCE_MAX_DAYS_VIOLATION:${arrivalRule.advanceMaxDays}`);
    }
  }

  for (const night of stayNights) {
    const rule = restrictionsByDate.get(night);
    if (rule?.stopSell) {
      violations.push(`STOP_SELL_ACTIVE:${night}`);
    }
  }

  const departureRule = restrictionsByDate.get(checkOutDate);
  if (departureRule?.closedToDeparture) {
    violations.push(`CLOSED_TO_DEPARTURE:${checkOutDate}`);
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function assertStayRestrictionsAllowed(result: StayRestrictionEvaluationResult): void {
  if (!result.allowed) {
    const hasStopSell = result.violations.some((v) => v.startsWith('STOP_SELL_ACTIVE'));
    if (hasStopSell) {
      throw new ConflictException(`BOOKING_RESTRICTION_VIOLATED: ${result.violations.join('; ')}`);
    }
    throw new BadRequestException(`BOOKING_RESTRICTION_VIOLATED: ${result.violations.join('; ')}`);
  }
}
