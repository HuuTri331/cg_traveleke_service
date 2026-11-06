import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingHoldItemStatus {
  HELD = 'HELD',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
}

@Entity('booking_hold_items')
export class BookingHoldItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hold_id', type: 'bigint', unsigned: true })
  holdId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'rate_plan_id', type: 'bigint', unsigned: true, nullable: true })
  ratePlanId!: string | null;

  @Column({ name: 'line_index', type: 'smallint', unsigned: true, default: 0 })
  lineIndex!: number;

  @Column({ name: 'quantity', type: 'smallint', unsigned: true })
  quantity!: number;

  @Column({ name: 'adults', type: 'smallint', unsigned: true, default: 2 })
  adults!: number;

  @Column({ name: 'children', type: 'smallint', unsigned: true, default: 0 })
  children!: number;

  @Column({ name: 'unit_base_price_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  unitBasePriceVnd!: number;

  @Column({ name: 'check_in_date', type: 'date' })
  checkInDate!: string;

  @Column({ name: 'check_out_date', type: 'date' })
  checkOutDate!: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: BookingHoldItemStatus.HELD })
  status!: BookingHoldItemStatus;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'committed_at', type: 'datetime', nullable: true })
  committedAt!: Date | null;

  @Column({ name: 'released_at', type: 'datetime', nullable: true })
  releasedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
