import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomUnitAllocationStatus {
  ASSIGNED = 'ASSIGNED',
  CHECKED_IN = 'CHECKED_IN',
  MOVED_OUT = 'MOVED_OUT',
  CHECKED_OUT = 'CHECKED_OUT',
  RELEASED = 'RELEASED',
}

@Entity('room_unit_allocations')
export class RoomUnitAllocation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'booking_room_id', type: 'bigint', unsigned: true, nullable: true })
  bookingRoomId!: string | null;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'room_unit_id', type: 'bigint', unsigned: true })
  roomUnitId!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: RoomUnitAllocationStatus.ASSIGNED,
  })
  status!: RoomUnitAllocationStatus;

  @Column({ name: 'check_in_date', type: 'date' })
  checkInDate!: string;

  @Column({ name: 'check_out_date', type: 'date' })
  checkOutDate!: string;

  @Column({ name: 'assigned_by', type: 'bigint', unsigned: true })
  assignedBy!: string;

  @Column({ name: 'assigned_at', type: 'datetime' })
  assignedAt!: Date;

  @Column({ name: 'checked_in_at', type: 'datetime', nullable: true })
  checkedInAt!: Date | null;

  @Column({ name: 'released_at', type: 'datetime', nullable: true })
  releasedAt!: Date | null;

  @Column({ name: 'release_reason', type: 'varchar', length: 100, nullable: true })
  releaseReason!: string | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
