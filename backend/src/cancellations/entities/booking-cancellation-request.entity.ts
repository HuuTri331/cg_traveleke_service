import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CancellationRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum CancellationRequesterType {
  CUSTOMER = 'CUSTOMER',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

@Entity('booking_cancellation_requests')
export class BookingCancellationRequest {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'booking_id',
    type: 'bigint',
    unsigned: true,
  })
  bookingId!: string;

  @Column({
    name: 'requested_by',
    type: 'bigint',
    unsigned: true,
  })
  requestedBy!: string;

  @Column({
    name: 'requester_type',
    type: 'varchar',
    length: 30,
    default: CancellationRequesterType.CUSTOMER,
  })
  requesterType!: CancellationRequesterType;

  @Column({
    type: 'text',
  })
  reason!: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: CancellationRequestStatus.PENDING,
  })
  status!: CancellationRequestStatus;

  @Column({
    name: 'reviewed_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  reviewedBy!: string | null;

  @Column({
    name: 'reviewed_at',
    type: 'datetime',
    nullable: true,
  })
  reviewedAt!: Date | null;

  @Column({
    name: 'review_note',
    type: 'text',
    nullable: true,
  })
  reviewNote!: string | null;

  @Column({
    name: 'refund_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  refundAmount!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
  })
  updatedAt!: Date;
}
