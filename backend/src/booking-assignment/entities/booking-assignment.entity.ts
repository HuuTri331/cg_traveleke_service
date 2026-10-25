import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum AssignmentType {
  AUTO = 'AUTO',
  MANAGER_FALLBACK = 'MANAGER_FALLBACK',
  MANUAL_OVERRIDE = 'MANUAL_OVERRIDE',
  LEGACY_IMPORT = 'LEGACY_IMPORT',
}

export enum FreshnessBucket {
  FRESH = 'FRESH', // >= 120 phút hoặc chưa từng nhận
  SOFT_RECENT = 'SOFT_RECENT', // 40 - 119 phút
  HARD_COOLDOWN = 'HARD_COOLDOWN', // < 40 phút
  OVERRIDE = 'OVERRIDE',
}

@Entity('booking_assignments')
export class BookingAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({
    name: 'staff_user_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  staffUserId!: string | null;

  @Column({
    name: 'assignment_version',
    type: 'int',
    unsigned: true,
    default: 1,
  })
  assignmentVersion!: number;

  @Column({
    name: 'assignment_type',
    type: 'varchar',
    length: 30,
    default: AssignmentType.AUTO,
  })
  assignmentType!: AssignmentType;

  @Column({
    name: 'competency_level',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  competencyLevel!: string | null; // M1, M2, M3, M4, MANAGER

  @Column({
    name: 'freshness_bucket',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  freshnessBucket!: FreshnessBucket | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'assigned_at', type: 'datetime' })
  assignedAt!: Date;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt!: Date | null;

  @Column({
    name: 'assigned_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  assignedBy!: string | null; // NULL: system auto

  @Column({
    name: 'previous_assignment_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  previousAssignmentId!: string | null;

  @Column({
    name: 'policy_version',
    type: 'varchar',
    length: 20,
    default: '1.0',
  })
  policyVersion!: string;

  @Column({
    name: 'source_event_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  sourceEventId!: string | null;
}
