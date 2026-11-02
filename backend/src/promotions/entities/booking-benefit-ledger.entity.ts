import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum BenefitLedgerEntryType {
  GRANT = 'GRANT',
  REDEEM = 'REDEEM',
  REVERSAL = 'REVERSAL',
  REFUND_SETTLEMENT = 'REFUND_SETTLEMENT',
  EXPIRE = 'EXPIRE',
}

@Entity('booking_benefit_ledger')
@Index('ux_benefit_ledger_idem', ['idempotencyKey'], { unique: true })
@Index('ix_benefit_ledger_booking', ['bookingId', 'occurredAt'])
export class BookingBenefitLedger {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'account_id', type: 'bigint', unsigned: true })
  accountId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'campaign_id', type: 'bigint', unsigned: true, nullable: true })
  campaignId!: string | null;

  @Column({ name: 'entry_type', type: 'varchar', length: 30 })
  entryType!: BenefitLedgerEntryType;

  @Column({ name: 'amount_delta', type: 'decimal', precision: 15, scale: 2, default: 0 })
  amountDelta!: number;

  @Column({ name: 'balance_after', type: 'decimal', precision: 15, scale: 2, default: 0 })
  balanceAfter!: number;

  @Column({ name: 'quota_delta', type: 'int', default: 0 })
  quotaDelta!: number;

  @Column({ name: 'quota_after', type: 'int', unsigned: true, default: 0 })
  quotaAfter!: number;

  @Column({ name: 'service_request_id', type: 'bigint', unsigned: true, nullable: true })
  serviceRequestId!: string | null;

  @Column({ name: 'reference_entry_id', type: 'bigint', unsigned: true, nullable: true })
  referenceEntryId!: string | null;

  @Column({ name: 'performed_by', type: 'bigint', unsigned: true, nullable: true })
  performedBy!: string | null;

  @Column({ name: 'coverage_grant_id', type: 'bigint', unsigned: true, nullable: true })
  coverageGrantId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'metadata_json', type: 'simple-json', nullable: true })
  metadata!: Record<string, any> | null;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt!: Date;
}
