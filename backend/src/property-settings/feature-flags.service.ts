import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { HotelFeatureFlagKey } from './entities/hotel-feature-flag.entity';

const STRICTLY_OFF_BY_DEFAULT = new Set<string>([
  HotelFeatureFlagKey.FF_PARTIAL_DEPOSIT,
  HotelFeatureFlagKey.FF_ICAL_CHANNEL_SYNC,
  HotelFeatureFlagKey.FF_GUEST_MAGIC_CHECKOUT,
  HotelFeatureFlagKey.FF_WAITLIST_RECOVERY,
  HotelFeatureFlagKey.ROOM_UNIT_CHECKIN_REQUIRED,
]);

@Injectable()
export class FeatureFlagsService {
  private readonly inMemoryOverrides = new Map<string, boolean>();

  constructor(@Optional() private readonly dataSource?: DataSource) {}

  private buildCacheKey(hotelId: string | number, flagKey: string): string {
    return `${String(hotelId)}:${flagKey}`;
  }

  setInMemoryFlag(hotelId: string | number, flagKey: string, enabled: boolean): void {
    this.inMemoryOverrides.set(this.buildCacheKey(hotelId, flagKey), enabled);
  }

  clearInMemoryFlags(): void {
    this.inMemoryOverrides.clear();
  }

  async isEnabled(
    hotelId: string | number,
    flagKey: HotelFeatureFlagKey | string,
    em?: EntityManager,
  ): Promise<boolean> {
    const cacheKey = this.buildCacheKey(hotelId, flagKey);
    if (this.inMemoryOverrides.has(cacheKey)) {
      return this.inMemoryOverrides.get(cacheKey)!;
    }

    const runner = em || this.dataSource;
    if (runner && typeof (runner as any).query === 'function') {
      try {
        const rows = await (runner as any).query(
          `SELECT enabled FROM hotel_feature_flags WHERE hotel_id = ? AND flag_key = ? LIMIT 1`,
          [String(hotelId), String(flagKey)],
        );
        if (Array.isArray(rows) && rows.length > 0 && rows[0]?.enabled !== undefined) {
          return Boolean(Number(rows[0].enabled));
        }
      } catch {
        // Fallback safely if table not yet migrated in legacy unit test mocks
      }
    }

    if (STRICTLY_OFF_BY_DEFAULT.has(String(flagKey))) {
      return false;
    }
    return false;
  }

  async setHotelFlag(
    hotelId: string | number,
    flagKey: HotelFeatureFlagKey | string,
    enabled: boolean,
    actorId?: string | null,
    configJson?: Record<string, any> | null,
    em?: EntityManager,
  ): Promise<{ hotelId: string; flagKey: string; enabled: boolean }> {
    this.setInMemoryFlag(hotelId, flagKey, enabled);
    const runner = em || this.dataSource;
    if (runner && typeof (runner as any).query === 'function') {
      try {
        await (runner as any).query(
          `INSERT INTO hotel_feature_flags (hotel_id, flag_key, enabled, config_json, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
          [
            String(hotelId),
            String(flagKey),
            enabled ? 1 : 0,
            configJson ? JSON.stringify(configJson) : null,
            actorId || null,
          ],
        );
      } catch {
        // Keep in-memory override active if DB table unavailable in test environment
      }
    }
    return {
      hotelId: String(hotelId),
      flagKey: String(flagKey),
      enabled,
    };
  }
}
