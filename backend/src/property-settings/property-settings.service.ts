import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HotelBusinessSetting } from './entities/hotel-business-setting.entity';
import { HotelFeatureFlagKey } from './entities/hotel-feature-flag.entity';
import { FeatureFlagsService } from './feature-flags.service';
import {
  DEFAULT_PROPERTY_CURRENCY,
  DEFAULT_PROPERTY_LOCALE,
  DEFAULT_PROPERTY_TIMEZONE,
  PropertyClockService,
} from './property-clock.service';

export interface UpdateHotelBusinessSettingDto {
  ianaTimezone?: string;
  locale?: string;
  currency?: string;
  cutoffTime?: string;
  requireRoomInspection?: boolean;
  allowGuestRoomNumberReveal?: boolean;
  freeEarlyCheckinMinutes?: number;
  freeLateCheckoutMinutes?: number;
  expectedVersion?: number;
  version?: number;
}

@Injectable()
export class PropertySettingsService {
  private readonly inMemorySettings = new Map<string, Partial<HotelBusinessSetting>>();

  constructor(
    private readonly propertyClock: PropertyClockService,
    private readonly featureFlags: FeatureFlagsService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private async assertHotelManagerOrAdmin(actor: { id: string; role: string }, hotelId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (!this.dataSource) return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, hotelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn hoặc ADMIN mới được thay đổi cấu hình khách sạn.');
    }
  }

  async assertStaffAccess(hotelId: string | number, actor: { id: string; role: string }): Promise<void> {
    const role = String(actor?.role || '').toUpperCase();
    if (role === 'ADMIN') return;
    if (role === 'CUSTOMER' || role === 'USER') {
      throw new ForbiddenException('Khách hàng không có quyền truy cập cấu hình vận hành nội bộ của khách sạn.');
    }
    if (!this.dataSource || typeof this.dataSource.query !== 'function') return;
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [actor.id, String(hotelId)],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('CROSS_HOTEL_FORBIDDEN: Nhân sự không thuộc biên chế khách sạn này.');
    }
  }

  async getHotelSettingsForActor(hotelId: string | number, actor: { id: string; role: string }) {
    await this.assertStaffAccess(hotelId, actor);
    return this.getHotelSettings(hotelId);
  }

  async getPublicHotelPolicy(hotelId: string | number) {
    const internal = await this.getHotelSettings(hotelId);
    return {
      hotelId: String(internal.hotelId),
      ianaTimezone: internal.ianaTimezone,
      locale: internal.locale,
      currency: internal.currency,
      standardCheckInTime: '14:00',
      standardCheckOutTime: '12:00',
    };
  }

  async getHotelSettings(hotelId: string | number) {
    const key = String(hotelId);
    const cached = this.inMemorySettings.get(key);
    if (this.dataSource && typeof this.dataSource.query === 'function') {
      try {
        const rows = await this.dataSource.query(
          `SELECT hotel_id AS hotelId, iana_timezone AS ianaTimezone, locale, currency, cutoff_time AS cutoffTime,
                  require_room_inspection AS requireRoomInspection, allow_guest_room_number_reveal AS allowGuestRoomNumberReveal,
                  free_early_checkin_minutes AS freeEarlyCheckinMinutes, free_late_checkout_minutes AS freeLateCheckoutMinutes, version
           FROM hotel_business_settings WHERE hotel_id = ? LIMIT 1`,
          [key],
        );
        if (Array.isArray(rows) && rows.length > 0) {
          const r = rows[0];
          return {
            hotelId: String(r.hotelId),
            ianaTimezone: r.ianaTimezone || DEFAULT_PROPERTY_TIMEZONE,
            locale: r.locale || DEFAULT_PROPERTY_LOCALE,
            currency: r.currency || DEFAULT_PROPERTY_CURRENCY,
            cutoffTime: r.cutoffTime || '04:00:00',
            requireRoomInspection: Boolean(Number(r.requireRoomInspection ?? 1)),
            allowGuestRoomNumberReveal: Boolean(Number(r.allowGuestRoomNumberReveal ?? 0)),
            freeEarlyCheckinMinutes: Number(r.freeEarlyCheckinMinutes ?? 60),
            freeLateCheckoutMinutes: Number(r.freeLateCheckoutMinutes ?? 30),
            version: Number(r.version ?? 1),
          };
        }
      } catch {
        // Fallback safely
      }
    }
    return {
      hotelId: key,
      ianaTimezone: cached?.ianaTimezone || DEFAULT_PROPERTY_TIMEZONE,
      locale: cached?.locale || DEFAULT_PROPERTY_LOCALE,
      currency: cached?.currency || DEFAULT_PROPERTY_CURRENCY,
      cutoffTime: cached?.cutoffTime || '04:00:00',
      requireRoomInspection: cached?.requireRoomInspection ?? true,
      allowGuestRoomNumberReveal: cached?.allowGuestRoomNumberReveal ?? false,
      freeEarlyCheckinMinutes: cached?.freeEarlyCheckinMinutes ?? 60,
      freeLateCheckoutMinutes: cached?.freeLateCheckoutMinutes ?? 30,
      version: cached?.version ?? 1,
    };
  }

  async updateHotelSettings(
    hotelId: string | number,
    dto: UpdateHotelBusinessSettingDto,
    actor: { id: string; role: string },
  ) {
    const key = String(hotelId);
    await this.assertHotelManagerOrAdmin(actor, key);
    if (dto.currency && dto.currency.toUpperCase() !== 'VND') {
      throw new BadRequestException('Giai đoạn hiện tại chỉ hỗ trợ tiền tệ thanh toán VND (không hỗ trợ FX tự động).');
    }
    const current = await this.getHotelSettings(key);
    const callerVersion = dto.expectedVersion ?? dto.version;
    if (
      callerVersion !== undefined &&
      callerVersion !== null &&
      Number(callerVersion) !== Number(current.version)
    ) {
      throw new ConflictException(
        `PROPERTY_SETTINGS_VERSION_CONFLICT: Cấu hình khách sạn #${key} đã thay đổi (expected=${callerVersion}, actual=${current.version}).`,
      );
    }
    const ianaTimezone = dto.ianaTimezone
      ? this.propertyClock.validateTimezone(dto.ianaTimezone)
      : current.ianaTimezone;
    const locale = (dto.locale || current.locale).trim();
    const cutoffTime = (dto.cutoffTime || current.cutoffTime).trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(cutoffTime)) {
      throw new BadRequestException('cutoffTime phải có định dạng HH:mm hoặc HH:mm:ss.');
    }
    const updated = {
      hotelId: key,
      ianaTimezone,
      locale,
      currency: 'VND',
      cutoffTime: cutoffTime.length === 5 ? `${cutoffTime}:00` : cutoffTime,
      requireRoomInspection: dto.requireRoomInspection ?? current.requireRoomInspection,
      allowGuestRoomNumberReveal: dto.allowGuestRoomNumberReveal ?? current.allowGuestRoomNumberReveal,
      freeEarlyCheckinMinutes: dto.freeEarlyCheckinMinutes ?? current.freeEarlyCheckinMinutes,
      freeLateCheckoutMinutes: dto.freeLateCheckoutMinutes ?? current.freeLateCheckoutMinutes,
      version: current.version + 1,
    };
    if (this.dataSource && typeof this.dataSource.query === 'function') {
      await this.dataSource.query(
        `INSERT INTO hotel_business_settings (
           hotel_id, iana_timezone, locale, currency, cutoff_time,
           require_room_inspection, allow_guest_room_number_reveal,
           free_early_checkin_minutes, free_late_checkout_minutes, version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           iana_timezone = VALUES(iana_timezone),
           locale = VALUES(locale),
           currency = VALUES(currency),
           cutoff_time = VALUES(cutoff_time),
           require_room_inspection = VALUES(require_room_inspection),
           allow_guest_room_number_reveal = VALUES(allow_guest_room_number_reveal),
           free_early_checkin_minutes = VALUES(free_early_checkin_minutes),
           free_late_checkout_minutes = VALUES(free_late_checkout_minutes),
           version = version + 1`,
        [
          key,
          updated.ianaTimezone,
          updated.locale,
          updated.currency,
          updated.cutoffTime,
          updated.requireRoomInspection ? 1 : 0,
          updated.allowGuestRoomNumberReveal ? 1 : 0,
          updated.freeEarlyCheckinMinutes,
          updated.freeLateCheckoutMinutes,
          updated.version,
        ],
      );
      this.inMemorySettings.delete(key);
      return this.getHotelSettings(key);
    }
    this.inMemorySettings.set(key, updated);
    return updated;
  }

  async toggleFeatureFlag(
    hotelId: string | number,
    flagKey: HotelFeatureFlagKey | string,
    enabled: boolean,
    actor: { id: string; role: string },
  ) {
    const key = String(hotelId);
    await this.assertHotelManagerOrAdmin(actor, key);
    return this.featureFlags.setHotelFlag(key, flagKey, enabled, actor.id);
  }
}
