import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ApprovalRequestType {
  REFUND = 'REFUND',
  RATE_OVERRIDE = 'RATE_OVERRIDE',
  DISCOUNT = 'DISCOUNT',
  COMPLIMENTARY = 'COMPLIMENTARY',
  SERVICE_RECOVERY = 'SERVICE_RECOVERY',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'approval_requests' })
export class ApprovalRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, nullable: true })
  bookingId!: string | null;

  @Column({
    name: 'request_type',
    type: 'varchar',
    length: 50,
  })
  requestType!: ApprovalRequestType;

  @Column({ name: 'requested_by', type: 'bigint', unsigned: true })
  requestedBy!: string;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  amount!: string;

  @Column({ name: 'reason', type: 'text' })
  reason!: string;

  @Column({ name: 'evidence_url', type: 'varchar', length: 500, nullable: true })
  evidenceUrl!: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: ApprovalStatus.PENDING,
  })
  status!: ApprovalStatus;

  @Column({ name: 'reviewed_by', type: 'bigint', unsigned: true, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
