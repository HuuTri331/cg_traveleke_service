import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
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
    name: 'contact_name',
    length: 150,
  })
  contactName!: string;

  @Column({
    name: 'contact_email',
    length: 255,
  })
  contactEmail!: string;

  @Column({
    name: 'contact_phone',
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