import { BadRequestException, Injectable } from '@nestjs/common';

export const DEFAULT_PROPERTY_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const DEFAULT_PROPERTY_CURRENCY = 'VND';
export const DEFAULT_PROPERTY_LOCALE = 'vi-VN';

@Injectable()
export class PropertyClockService {
  /**
   * Validates that an IANA timezone is recognized by Intl.DateTimeFormat
   */
  validateTimezone(ianaTimezone: string): string {
    const trimmed = (ianaTimezone || DEFAULT_PROPERTY_TIMEZONE).trim();
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: trimmed }).format(new Date());
      return trimmed;
    } catch {
      throw new BadRequestException(`Múi giờ IANA không hợp lệ: "${ianaTimezone}"`);
    }
  }

  /**
   * Converts a Date or date string into YYYY-MM-DD in the property's local IANA timezone.
   * Never uses Date.toISOString().slice(0, 10) directly when given an instant.
   */
  toLocalDateStr(input: Date | string, ianaTimezone = DEFAULT_PROPERTY_TIMEZONE): string {
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
      return input.trim();
    }
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Thời điểm không hợp lệ: "${String(input)}"`);
    }
    const tz = this.validateTimezone(ianaTimezone);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return `${y}-${m}-${day}`;
  }

  /**
   * Returns local hour and minute (HH:mm:ss) in property's IANA timezone
   */
  toLocalTimeStr(input: Date | string, ianaTimezone = DEFAULT_PROPERTY_TIMEZONE): string {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Thời điểm không hợp lệ: "${String(input)}"`);
    }
    const tz = this.validateTimezone(ianaTimezone);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = parts.find((p) => p.type === 'hour')?.value || '00';
    const mm = parts.find((p) => p.type === 'minute')?.value || '00';
    const ss = parts.find((p) => p.type === 'second')?.value || '00';
    return `${hh}:${mm}:${ss}`;
  }

  /**
   * Adds N calendar days to a YYYY-MM-DD date string
   */
  addDays(dateStr: string, days: number): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException(`Định dạng ngày phải là YYYY-MM-DD: "${dateStr}"`);
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + days));
    return utc.toISOString().slice(0, 10);
  }

  /**
   * Enumerates half-open stay nights [checkInDate, checkOutDate) in the property's local IANA timezone.
   */
  enumerateStayNights(
    checkInAt: Date | string,
    checkOutAt: Date | string,
    ianaTimezone = DEFAULT_PROPERTY_TIMEZONE,
  ): string[] {
    const startStr = this.toLocalDateStr(checkInAt, ianaTimezone);
    const endStr = this.toLocalDateStr(checkOutAt, ianaTimezone);
    if (endStr <= startStr) {
      throw new BadRequestException(
        `Kỳ lưu trú không hợp lệ theo múi giờ khách sạn (${ianaTimezone}): [${startStr}, ${endStr})`,
      );
    }
    const nights: string[] = [];
    let cursor = startStr;
    while (cursor < endStr) {
      nights.push(cursor);
      cursor = this.addDays(cursor, 1);
      if (nights.length > 366) {
        throw new BadRequestException('Kỳ lưu trú vượt quá số đêm tối đa cho phép (366 đêm).');
      }
    }
    return nights;
  }

  /**
   * Resolves the hotel's business date at a given instant (respecting optional cutoff time, e.g., 04:00:00)
   */
  resolveBusinessDate(
    instant: Date | string = new Date(),
    ianaTimezone = DEFAULT_PROPERTY_TIMEZONE,
    cutoffTime = '00:00:00',
  ): string {
    const localDate = this.toLocalDateStr(instant, ianaTimezone);
    if (!cutoffTime || cutoffTime === '00:00:00') {
      return localDate;
    }
    const localTime = this.toLocalTimeStr(instant, ianaTimezone);
    if (localTime < cutoffTime) {
      return this.addDays(localDate, -1);
    }
    return localDate;
  }

  /**
   * Enforces VND integer monetary values (no fractional cents or negative unexpected floats)
   */
  assertValidVndAmount(amount: number | string, allowNegative = false): number {
    const num = Number(amount);
    if (!Number.isFinite(num)) {
      throw new BadRequestException(`Số tiền VND không hợp lệ: "${String(amount)}"`);
    }
    const rounded = Math.round(num);
    if (Math.abs(num - rounded) > 0.001) {
      throw new BadRequestException(`Tiền tệ VND không chấp nhận phần thập phân lẻ: ${amount}`);
    }
    if (!allowNegative && rounded < 0) {
      throw new BadRequestException(`Số tiền VND không được âm: ${amount}`);
    }
    return rounded;
  }
}
