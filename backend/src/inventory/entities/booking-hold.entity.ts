import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingHoldStatus {
  HELD = 'HELD',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
}

@Entity('booking_holds')
export class BookingHold {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'booking_id',
    type: 'bigint',
    unsigned: true,
    unique: true,
  })
  bookingId!: string;

  @Column({
    name: 'room_id',
    type: 'bigint',
    unsigned: true,
  })
  roomId!: string;

  @Column({
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  quantity!: number;

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
    type: 'varchar',
    length: 30,
    default: BookingHoldStatus.HELD,
  })
  status!: BookingHoldStatus;

  @Column({
    name: 'hold_expires_at',
    type: 'datetime',
  })
  holdExpiresAt!: Date;

  @Column({
    name: 'released_at',
    type: 'datetime',
    nullable: true,
  })
  releasedAt!: Date | null;

  @Column({
    name: 'committed_at',
    type: 'datetime',
    nullable: true,
  })
  committedAt!: Date | null;

  @Column({
    name: 'release_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  releaseReason!: string | null;

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
