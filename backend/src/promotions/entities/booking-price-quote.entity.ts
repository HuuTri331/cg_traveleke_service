import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export interface NightlyPriceLine {
  nightDate: string; // YYYY-MM-DD local hotel date
  roomId: string;
  quantity: number;
  baseRatePerRoom: number;
  baseSubtotal: number;
  appliedCampaignId: string | null;
  appliedCampaignCode: string | null;
  appliedCampaignVersion: number | null;
  discountAmount: number;
  payableSubtotal: number;
}

@Entity('booking_price_quotes')
@Index('ux_price_quote_code', ['quoteCode'], { unique: true })
@Index('ix_price_quotes_booking', ['bookingId'])
export class BookingPriceQuote {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'quote_code', type: 'varchar', length: 64 })
  quoteCode!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, nullable: true })
  bookingId!: string | null;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId!: string | null;

  @Column({ name: 'room_id', type: 'bigint', unsigned: true })
  roomId!: string;

  @Column({ name: 'room_quantity', type: 'smallint', unsigned: true, default: 1 })
  roomQuantity!: number;

  @Column({ name: 'total_guests', type: 'smallint', unsigned: true, default: 1 })
  totalGuests!: number;

  @Column({ name: 'check_in_local_date', type: 'varchar', length: 10 })
  checkInLocalDate!: string;

  @Column({ name: 'check_out_local_date', type: 'varchar', length: 10 })
  checkOutLocalDate!: string;

  @Column({ name: 'nights_count', type: 'smallint', unsigned: true })
  nightsCount!: number;

  @Column({ name: 'base_total', type: 'decimal', precision: 15, scale: 2 })
  baseTotal!: number;

  @Column({ name: 'discount_total', type: 'decimal', precision: 15, scale: 2, default: 0 })
  discountTotal!: number;

  @Column({ name: 'payable_total', type: 'decimal', precision: 15, scale: 2 })
  payableTotal!: number;

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency!: string;

  @Column({ name: 'hotel_timezone', type: 'varchar', length: 50, default: 'Asia/Ho_Chi_Minh' })
  hotelTimezone!: string;

  @Column({ name: 'price_hash', type: 'varchar', length: 64 })
  priceHash!: string;

  @Column({ name: 'nightly_lines_json', type: 'simple-json' })
  nightlyLines!: NightlyPriceLine[];

  @Column({ name: 'applied_campaigns_json', type: 'simple-json', nullable: true })
  appliedCampaigns!: Array<{
    campaignId: string;
    code: string;
    name: string;
    version: number;
    benefitKind: string;
    discountAmount: number;
  }> | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'SUPERSEDED';

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
