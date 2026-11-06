import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('voucher_codes')
export class VoucherCode {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'discount_type', type: 'varchar', length: 20, default: 'FIXED_AMOUNT' })
  discountType!: 'FIXED_AMOUNT' | 'PERCENT';

  @Column({ name: 'discount_value', type: 'decimal', precision: 15, scale: 2 })
  discountValue!: number;

  @Column({ name: 'max_discount_vnd', type: 'decimal', precision: 15, scale: 2, nullable: true })
  maxDiscountVnd!: number | null;

  @Column({ name: 'min_nights', type: 'smallint', unsigned: true, default: 1 })
  minNights!: number;

  @Column({ name: 'min_spend_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  minSpendVnd!: number;

  @Column({ name: 'allow_stack_with_campaign', type: 'tinyint', width: 1, default: 0 })
  allowStackWithCampaign!: boolean;

  @Column({ name: 'max_uses_total', type: 'int', unsigned: true, default: 100 })
  maxUsesTotal!: number;

  @Column({ name: 'max_uses_per_user', type: 'smallint', unsigned: true, default: 1 })
  maxUsesPerUser!: number;

  @Column({ name: 'used_count', type: 'int', unsigned: true, default: 0 })
  usedCount!: number;

  @Column({ name: 'valid_from', type: 'datetime' })
  validFrom!: Date;

  @Column({ name: 'valid_to', type: 'datetime' })
  validTo!: Date;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('voucher_reservations')
export class VoucherReservation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'voucher_id', type: 'bigint', unsigned: true })
  voucherId!: string;

  @Column({ name: 'quote_id', type: 'bigint', unsigned: true })
  quoteId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, nullable: true })
  bookingId!: string | null;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'discount_vnd', type: 'decimal', precision: 15, scale: 2 })
  discountVnd!: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'RESERVED' })
  status!: 'RESERVED' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'released_at', type: 'datetime', nullable: true })
  releasedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
