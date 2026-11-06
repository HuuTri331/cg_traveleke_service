import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum HotelFeatureFlagKey {
  ROOM_UNIT_CHECKIN_REQUIRED = 'ROOM_UNIT_CHECKIN_REQUIRED',
  FF_PHYSICAL_ROOM_UNITS = 'FF_PHYSICAL_ROOM_UNITS',
  FF_HOUSEKEEPING_GATE = 'FF_HOUSEKEEPING_GATE',
  FF_MAINTENANCE_BLOCKOUTS = 'FF_MAINTENANCE_BLOCKOUTS',
  FF_ROOM_MOVE_WORKFLOW = 'FF_ROOM_MOVE_WORKFLOW',
  FF_TODAY_FRONT_DESK_BOARD = 'FF_TODAY_FRONT_DESK_BOARD',
  FF_ROOM_READINESS_INCIDENT = 'FF_ROOM_READINESS_INCIDENT',
  FF_MULTI_ROOM_CART = 'FF_MULTI_ROOM_CART',
  FF_RATE_PLAN_ENGINE = 'FF_RATE_PLAN_ENGINE',
  FF_BOOKING_RESTRICTIONS = 'FF_BOOKING_RESTRICTIONS',
  FF_TAX_FEE_ENGINE = 'FF_TAX_FEE_ENGINE',
  FF_CANCELLATION_POLICY_ENGINE = 'FF_CANCELLATION_POLICY_ENGINE',
  FF_VOUCHER_CHECKOUT = 'FF_VOUCHER_CHECKOUT',
  FF_BOOKING_AMENDMENT = 'FF_BOOKING_AMENDMENT',
  FF_FOLIO_LEDGER = 'FF_FOLIO_LEDGER',
  FF_NIGHT_AUDIT = 'FF_NIGHT_AUDIT',
  FF_PRECHECKIN_OCCUPANTS = 'FF_PRECHECKIN_OCCUPANTS',
  FF_STAY_CSAT_CRM = 'FF_STAY_CSAT_CRM',
  // R5 optional features — strictly OFF by default unless explicitly approved
  FF_PARTIAL_DEPOSIT = 'FF_PARTIAL_DEPOSIT',
  FF_ICAL_CHANNEL_SYNC = 'FF_ICAL_CHANNEL_SYNC',
  FF_GUEST_MAGIC_CHECKOUT = 'FF_GUEST_MAGIC_CHECKOUT',
  FF_WAITLIST_RECOVERY = 'FF_WAITLIST_RECOVERY',
}

@Entity('hotel_feature_flags')
export class HotelFeatureFlag {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'flag_key', type: 'varchar', length: 64 })
  flagKey!: string;

  @Column({ name: 'enabled', type: 'tinyint', width: 1, default: 0 })
  enabled!: boolean;

  @Column({ name: 'config_json', type: 'json', nullable: true })
  configJson!: Record<string, any> | null;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
