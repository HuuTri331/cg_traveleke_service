import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingAmendmentStatus {
  QUOTED = 'QUOTED',
  AWAITING_CUSTOMER_CONSENT = 'AWAITING_CUSTOMER_CONSENT',
  AWAITING_SURCHARGE_PAYMENT = 'AWAITING_SURCHARGE_PAYMENT',
  READY_TO_COMMIT = 'READY_TO_COMMIT',
  COMMITTED = 'COMMITTED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

@Entity('booking_amendments')
export class BookingAmendment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'amendment_version', type: 'int', unsigned: true, default: 1 })
  amendmentVersion!: number;

  @Column({ name: 'amendment_type', type: 'varchar', length: 40, default: 'DATE_CHANGE' })
  amendmentType!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 40,
    default: BookingAmendmentStatus.QUOTED,
  })
  status!: BookingAmendmentStatus;

  @Column({ name: 'previous_snapshot_json', type: 'json' })
  previousSnapshotJson!: Record<string, any>;

  @Column({ name: 'requested_change_json', type: 'json' })
  requestedChangeJson!: Record<string, any>;

  @Column({ name: 'quote_hash', type: 'char', length: 64 })
  quoteHash!: string;

  @Column({ name: 'quote_expires_at', type: 'datetime' })
  quoteExpiresAt!: Date;

  @Column({ name: 'old_total_vnd', type: 'decimal', precision: 15, scale: 2 })
  oldTotalVnd!: number;

  @Column({ name: 'new_total_vnd', type: 'decimal', precision: 15, scale: 2 })
  newTotalVnd!: number;

  @Column({ name: 'delta_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  deltaVnd!: number;

  @Column({ name: 'penalty_fee_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  penaltyFeeVnd!: number;

  @Column({ name: 'requested_by', type: 'bigint', unsigned: true })
  requestedBy!: string;

  @Column({ name: 'reviewed_by', type: 'bigint', unsigned: true, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'customer_consent_at', type: 'datetime', nullable: true })
  customerConsentAt!: Date | null;

  @Column({ name: 'payment_txn_id', type: 'bigint', unsigned: true, nullable: true })
  paymentTxnId!: string | null;

  @Column({ name: 'committed_at', type: 'datetime', nullable: true })
  committedAt!: Date | null;

  @Column({ name: 'command_key', type: 'varchar', length: 100 })
  commandKey!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('amendment_hold_items')
export class AmendmentHoldItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'amendment_id', type: 'bigint', unsigned: true })
  amendmentId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'stay_date', type: 'date' })
  stayDate!: string;

  @Column({ name: 'delta_quantity', type: 'smallint' })
  deltaQuantity!: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'HELD' })
  status!: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
