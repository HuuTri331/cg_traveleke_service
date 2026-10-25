import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingStatus {
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  PAYMENT_EXPIRED = 'PAYMENT_EXPIRED',
  PAYMENT_REVIEW = 'PAYMENT_REVIEW',
  NO_SHOW = 'NO_SHOW',
  CLOSED_NO_SHOW = 'CLOSED_NO_SHOW',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'booking_code',
    type: 'varchar',
    length: 30,
    unique: true,
  })
  bookingCode!: string;

  @Column({
    name: 'user_id',
    type: 'bigint',
    unsigned: true,
  })
  userId!: string;

  @Column({
    name: 'hotel_id',
    type: 'bigint',
    unsigned: true,
  })
  hotelId!: string;

  @Column({
    name: 'trip_plan_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  tripPlanId!: string | null;

  @Column({
    name: 'handled_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  handledBy!: string | null;

  @Column({
    name: 'assignment_type',
    type: 'varchar',
    length: 20,
    default: 'AUTO',
  })
  assignmentType!: string;

  @Column({
    name: 'assignment_note',
    type: 'text',
    nullable: true,
  })
  assignmentNote!: string | null;

  @Column({
    name: 'booking_source',
    type: 'varchar',
    length: 30,
    default: 'WEBSITE',
  })
  bookingSource!: string;

  @Column({
    name: 'created_by_staff_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  createdByStaffId!: string | null;

  @Column({
    name: 'reassigned_at',
    type: 'datetime',
    nullable: true,
  })
  reassignedAt!: Date | null;

  @Column({
    name: 'reassigned_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  reassignedBy!: string | null;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 150,
  })
  contactName!: string;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 255,
  })
  contactEmail!: string;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 20,
  })
  contactPhone!: string;

  @Column({
    name: 'check_in_at',
    type: 'datetime',
  })
  checkInAt!: Date;

  @Column({
    name: 'check_out_at',
    type: 'datetime',
  })
  checkOutAt!: Date;

  @Column({
    name: 'total_guests',
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  totalGuests!: number;

  @Column({
    name: 'requested_room_count',
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  requestedRoomCount!: number;

  @Column({
    name: 'estimated_total',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  estimatedTotal!: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: BookingStatus.PENDING,
  })
  status!: BookingStatus;

  @Column({
    name: 'special_request',
    type: 'text',
    nullable: true,
  })
  specialRequest!: string | null;

  @Column({
    name: 'confirmed_at',
    type: 'datetime',
    nullable: true,
  })
  confirmedAt!: Date | null;

  @Column({
    name: 'rejected_at',
    type: 'datetime',
    nullable: true,
  })
  rejectedAt!: Date | null;

  @Column({
    name: 'cancelled_at',
    type: 'datetime',
    nullable: true,
  })
  cancelledAt!: Date | null;

  @Column({
    name: 'actual_check_in_at',
    type: 'datetime',
    nullable: true,
  })
  actualCheckInAt!: Date | null;

  @Column({
    name: 'actual_check_out_at',
    type: 'datetime',
    nullable: true,
  })
  actualCheckOutAt!: Date | null;

  @Column({
    name: 'no_show_at',
    type: 'datetime',
    nullable: true,
  })
  noShowAt!: Date | null;

  @Column({
    name: 'no_show_grace_minutes',
    type: 'smallint',
    unsigned: true,
    default: 360,
  })
  noShowGraceMinutes!: number;

  @Column({
    name: 'no_show_closed_at',
    type: 'datetime',
    nullable: true,
  })
  noShowClosedAt!: Date | null;

  @Column({
    name: 'late_check_in_recovered_at',
    type: 'datetime',
    nullable: true,
  })
  lateCheckInRecoveredAt!: Date | null;

  @Column({
    name: 'check_in_confirmed_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  checkInConfirmedBy!: string | null;

  @Column({
    name: 'check_out_confirmed_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  checkOutConfirmedBy!: string | null;

  @Column({
    name: 'presence_version',
    type: 'int',
    unsigned: true,
    default: 1,
  })
  presenceVersion!: number;

  @Column({
    name: 'late_arrival_expected_at',
    type: 'datetime',
    nullable: true,
  })
  lateArrivalExpectedAt!: Date | null;

  @Column({
    name: 'late_arrival_note',
    type: 'text',
    nullable: true,
  })
  lateArrivalNote!: string | null;

  @Column({
    name: 'checkout_idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
    unique: true,
  })
  checkoutIdempotencyKey!: string | null;

  @Column({
    name: 'checkout_request_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  checkoutRequestHash!: string | null;

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
