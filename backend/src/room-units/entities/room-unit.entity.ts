import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomUnitOperationalStatus {
  ACTIVE = 'ACTIVE',
  IN_SERVICE = 'IN_SERVICE',
  OUT_OF_ORDER = 'OUT_OF_ORDER',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  INACTIVE = 'INACTIVE',
}

export enum RoomUnitHousekeepingState {
  READY = 'READY',
  CLEAN = 'CLEAN',
  DIRTY = 'DIRTY',
  INSPECTION_PENDING = 'INSPECTION_PENDING',
  DO_NOT_DISTURB = 'DO_NOT_DISTURB',
}

@Entity('room_units')
@Index('uq_room_unit_number', ['hotelId', 'roomNumber'], { unique: true })
export class RoomUnit {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'room_number', type: 'varchar', length: 40 })
  roomNumber!: string;

  @Column({ name: 'floor', type: 'varchar', length: 20, nullable: true })
  floor!: string | null;

  @Column({ name: 'floor_code', type: 'varchar', length: 40, nullable: true })
  floorCode?: string | null;

  @Column({ name: 'building', type: 'varchar', length: 50, nullable: true })
  building!: string | null;

  @Column({ name: 'bed_config', type: 'varchar', length: 80, nullable: true })
  bedConfig!: string | null;

  @Column({ name: 'is_accessible', type: 'tinyint', width: 1, default: 0 })
  isAccessible!: boolean;

  @Column({ name: 'is_smoking', type: 'tinyint', width: 1, default: 0 })
  isSmoking!: boolean;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 20,
    default: 'VERIFIED',
  })
  verificationStatus?: string;

  @Column({
    name: 'operational_state',
    type: 'varchar',
    length: 20,
    default: 'IN_SERVICE',
  })
  operationalState?: string;

  @Column({
    name: 'operational_status',
    type: 'varchar',
    length: 30,
    default: RoomUnitOperationalStatus.ACTIVE,
  })
  operationalStatus!: RoomUnitOperationalStatus;

  @Column({
    name: 'housekeeping_state',
    type: 'varchar',
    length: 30,
    default: RoomUnitHousekeepingState.READY,
  })
  housekeepingState!: RoomUnitHousekeepingState;

  @Column({ name: 'last_cleaned_at', type: 'datetime', nullable: true })
  lastCleanedAt!: Date | null;

  @Column({ name: 'last_inspected_at', type: 'datetime', nullable: true })
  lastInspectedAt!: Date | null;

  @Column({ name: 'last_inspected_by', type: 'bigint', unsigned: true, nullable: true })
  lastInspectedBy!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
