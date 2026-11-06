import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FolioStatus {
  OPEN = 'OPEN',
  SETTLED = 'SETTLED',
  CLOSED = 'CLOSED',
  DISPUTED = 'DISPUTED',
}

export enum FolioEntryKind {
  ROOM_CHARGE = 'ROOM_CHARGE',
  SERVICE_CHARGE = 'SERVICE_CHARGE',
  STAY_TIME_FEE = 'STAY_TIME_FEE',
  AMENDMENT_DELTA = 'AMENDMENT_DELTA',
  GATEWAY_PAYMENT = 'GATEWAY_PAYMENT',
  DESK_SETTLEMENT = 'DESK_SETTLEMENT',
  BENEFIT_CREDIT = 'BENEFIT_CREDIT',
  COMPENSATION_CREDIT = 'COMPENSATION_CREDIT',
  ADJUSTMENT = 'ADJUSTMENT',
  REVERSAL = 'REVERSAL',
  REFUND = 'REFUND',
}

@Entity('folios')
export class Folio {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, unique: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'folio_number', type: 'varchar', length: 40, unique: true })
  folioNumber!: string;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'VND' })
  currency!: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: FolioStatus.OPEN })
  status!: FolioStatus;

  @Column({ name: 'total_debit_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalDebitVnd!: number;

  @Column({ name: 'total_payment_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalPaymentVnd!: number;

  @Column({ name: 'total_credit_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCreditVnd!: number;

  @Column({ name: 'total_refund_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalRefundVnd!: number;

  @Column({ name: 'outstanding_balance_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  outstandingBalanceVnd!: number;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by', type: 'bigint', unsigned: true, nullable: true })
  closedBy!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('folio_entries')
export class FolioEntry {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'folio_id', type: 'bigint', unsigned: true })
  folioId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'entry_kind', type: 'varchar', length: 40 })
  entryKind!: FolioEntryKind;

  @Column({ name: 'direction', type: 'varchar', length: 10 })
  direction!: 'DEBIT' | 'PAYMENT' | 'CREDIT' | 'REFUND';

  @Column({ name: 'amount_vnd', type: 'decimal', precision: 15, scale: 2 })
  amountVnd!: number;

  @Column({ name: 'tax_amount_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  taxAmountVnd!: number;

  @Column({ name: 'business_date', type: 'date' })
  businessDate!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 40 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 80 })
  sourceId!: string;

  @Column({ name: 'reverses_entry_id', type: 'bigint', unsigned: true, nullable: true })
  reversesEntryId!: string | null;

  @Column({ name: 'description', type: 'varchar', length: 255 })
  description!: string;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true, nullable: true })
  actorId!: string | null;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, unique: true })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'posted_at', type: 'datetime' })
  postedAt!: Date;
}

@Entity('folio_settlements')
export class FolioSettlement {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'folio_id', type: 'bigint', unsigned: true })
  folioId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'method', type: 'varchar', length: 30 })
  method!: string;

  @Column({ name: 'amount_vnd', type: 'decimal', precision: 15, scale: 2 })
  amountVnd!: number;

  @Column({ name: 'provider_ref', type: 'varchar', length: 100 })
  providerRef!: string;

  @Column({ name: 'evidence_url', type: 'varchar', length: 500, nullable: true })
  evidenceUrl!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'VERIFIED' })
  status!: string;

  @Column({ name: 'paid_at', type: 'datetime' })
  paidAt!: Date;

  @Column({ name: 'verified_at', type: 'datetime' })
  verifiedAt!: Date;

  @Column({ name: 'recorded_by', type: 'bigint', unsigned: true })
  recordedBy!: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
