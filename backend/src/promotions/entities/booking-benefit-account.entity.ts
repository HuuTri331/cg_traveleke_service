import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BenefitKind } from './promotion-campaign.entity';

export enum BenefitAccountStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REFUND_PENDING = 'REFUND_PENDING',
  SETTLED = 'SETTLED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

@Entity('booking_benefit_accounts')
@Index('ux_benefit_account_dedupe', ['dedupeKey'], { unique: true })
@Index('ix_benefit_account_booking', ['bookingId', 'status'])
export class BookingBenefitAccount {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'campaign_id', type: 'bigint', unsigned: true, nullable: true })
  campaignId!: string | null;

  @Column({ name: 'benefit_kind', type: 'varchar', length: 40, default: BenefitKind.ROOM_PRICE_ADJUSTMENT })
  benefitKind!: BenefitKind;

  @Column({ name: 'source_type', type: 'varchar', length: 40, default: 'CAMPAIGN_RETROACTIVE' })
  sourceType!: string;

  @Column({ type: 'varchar', length: 30, default: BenefitAccountStatus.APPROVED })
  status!: BenefitAccountStatus;

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency!: string;

  @Column({ name: 'granted_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  grantedAmount!: number;

  @Column({ name: 'redeemed_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  redeemedAmount!: number;

  @Column({ name: 'reversed_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reversedAmount!: number;

  @Column({ name: 'refunded_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  refundedAmount!: number;

  @Column({ name: 'available_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  availableAmount!: number;

  @Column({ name: 'granted_quota', type: 'int', unsigned: true, default: 0 })
  grantedQuota!: number;

  @Column({ name: 'used_quota', type: 'int', unsigned: true, default: 0 })
  usedQuota!: number;

  @Column({ name: 'available_quota', type: 'int', unsigned: true, default: 0 })
  availableQuota!: number;

  @Column({ name: 'allowed_service_ids_json', type: 'simple-json', nullable: true })
  allowedServiceIds!: string[] | null;

  // POL-04 / B22: Room-price adjustment cannot be forced into service credit without customer agreement
  @Column({ name: 'customer_accepted_credit', type: 'boolean', default: false })
  customerAcceptedCredit!: boolean;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 160 })
  dedupeKey!: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
