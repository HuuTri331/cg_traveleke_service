import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomBlockType {
  OUT_OF_ORDER = 'OUT_OF_ORDER',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  RENOVATION = 'RENOVATION',
}

export enum RoomBlockStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
}

@Entity('room_unit_blocks')
export class RoomUnitBlock {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'room_unit_id', type: 'bigint', unsigned: true })
  roomUnitId!: string;

  @Column({
    name: 'block_type',
    type: 'varchar',
    length: 30,
    default: RoomBlockType.OUT_OF_ORDER,
  })
  blockType!: RoomBlockType;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: RoomBlockStatus.ACTIVE,
  })
  status!: RoomBlockStatus;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_exclusive_date', type: 'date' })
  endExclusiveDate!: string;

  @Column({ name: 'reason', type: 'varchar', length: 255 })
  reason!: string;

  @Column({ name: 'requested_by', type: 'bigint', unsigned: true })
  requestedBy!: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'released_by', type: 'bigint', unsigned: true, nullable: true })
  releasedBy!: string | null;

  @Column({ name: 'released_at', type: 'datetime', nullable: true })
  releasedAt!: Date | null;

  @Column({ name: 'impacted_booking_ids_json', type: 'json', nullable: true })
  impactedBookingIdsJson!: string[] | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('room_type_stop_sell_rules')
export class RoomTypeStopSellRule {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_exclusive_date', type: 'date' })
  endExclusiveDate!: string;

  @Column({ name: 'blocked_count', type: 'smallint', unsigned: true, default: 0 })
  blockedCount!: number;

  @Column({ name: 'stop_sell', type: 'tinyint', width: 1, default: 1 })
  stopSell!: boolean;

  @Column({ name: 'reason', type: 'varchar', length: 255 })
  reason!: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: string;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
