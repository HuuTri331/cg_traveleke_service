import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AvailabilityBlockType {
  LEAVE = 'LEAVE',
  LATE_ARRIVAL = 'LATE_ARRIVAL',
  EARLY_LEAVE = 'EARLY_LEAVE',
  SHORT_ABSENCE = 'SHORT_ABSENCE',
  EMERGENCY_UNAVAILABLE = 'EMERGENCY_UNAVAILABLE',
}

export enum AvailabilityBlockSource {
  APPROVED_REQUEST = 'APPROVED_REQUEST',
  MANAGER_OVERRIDE = 'MANAGER_OVERRIDE',
}

@Entity('staff_availability_blocks')
export class StaffAvailabilityBlock {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({ name: 'request_id', type: 'bigint', unsigned: true, nullable: true })
  requestId!: string | null;

  @Column({
    name: 'block_type',
    type: 'varchar',
    length: 30,
  })
  blockType!: AvailabilityBlockType;

  @Column({ name: 'start_at', type: 'datetime' })
  startAt!: Date;

  @Column({ name: 'end_at', type: 'datetime' })
  endAt!: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ type: 'tinyint', default: 1 })
  active!: number; // 1: active, 0: revoked/cancelled

  @Column({
    type: 'varchar',
    length: 30,
    default: AvailabilityBlockSource.APPROVED_REQUEST,
  })
  source!: AvailabilityBlockSource;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: string;

  @Column({ name: 'ended_by', type: 'bigint', unsigned: true, nullable: true })
  endedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
