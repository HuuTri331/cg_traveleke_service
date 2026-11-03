import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type RefundProviderMode = 'MOCK' | 'VNPAY_SANDBOX' | 'MANUAL_TEST' | 'VNPAY_LIVE';

export enum RefundIntentStatus {
  REQUESTED = 'REQUESTED',
  PROCESSING = 'PROCESSING',
  SIMULATED_SUCCEEDED = 'SIMULATED_SUCCEEDED',
  SANDBOX_ACCEPTED = 'SANDBOX_ACCEPTED',
  SANDBOX_SETTLED = 'SANDBOX_SETTLED',
  MANUAL_TEST_VERIFIED = 'MANUAL_TEST_VERIFIED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  UNKNOWN_RECONCILE = 'UNKNOWN_RECONCILE',
}

@Entity('promotion_refund_intents')
@Index('ux_promo_refund_intent_idem', ['idempotencyKey'], { unique: true })
@Index('ix_promo_refund_intent_booking', ['bookingId', 'status'])
export class PromotionRefundIntent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'account_id', type: 'bigint', unsigned: true })
  accountId!: string;

  @Column({ name: 'payment_id', type: 'bigint', unsigned: true, nullable: true })
  paymentId!: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: number;

  @Column({ type: 'varchar', length: 30, default: 'VNPAY_PROVIDER' })
  channel!: 'VNPAY_PROVIDER' | 'BANK_TRANSFER_PROOF' | 'CASH_RECEIPT';

  @Column({ type: 'varchar', length: 30, default: RefundIntentStatus.REQUESTED })
  status!: RefundIntentStatus;

  @Column({ name: 'provider_ref', type: 'varchar', length: 120, nullable: true })
  providerRef!: string | null;

  @Column({ name: 'payout_receipt_ref', type: 'varchar', length: 160, nullable: true })
  payoutReceiptRef!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey!: string;

  @Column({ name: 'requested_by', type: 'bigint', unsigned: true })
  requestedBy!: string;

  @Column({ name: 'verified_by', type: 'bigint', unsigned: true, nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
