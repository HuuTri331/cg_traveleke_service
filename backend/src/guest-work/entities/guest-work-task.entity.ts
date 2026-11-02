import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WorkTaskType {
  PRE_ARRIVAL_CONTACT = 'PRE_ARRIVAL_CONTACT',
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
  SERVICE_REQUEST = 'SERVICE_REQUEST',
  COMPLAINT_HANDLE = 'COMPLAINT_HANDLE',
}

export enum WorkTaskStatus {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  VERIFIED = 'VERIFIED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum WorkTaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

@Entity('guest_work_tasks')
@Index('ix_tasks_hotel_assignee_status', ['hotelId', 'assignedStaffId', 'status'])
@Index('ix_tasks_booking_type', ['bookingId', 'type'])
export class GuestWorkTask {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({
    type: 'varchar',
    length: 30,
  })
  type!: WorkTaskType;

  @Column({ name: 'source_table', type: 'varchar', length: 50, nullable: true })
  sourceTable!: string | null;

  @Column({ name: 'source_id', type: 'varchar', length: 50, nullable: true })
  sourceId!: string | null;

  @Column({ name: 'assigned_staff_id', type: 'bigint', unsigned: true, nullable: true })
  assignedStaffId!: string | null;

  @Column({ name: 'active_executor_id', type: 'bigint', unsigned: true, nullable: true })
  activeExecutorId!: string | null;

  @Column({ name: 'coverage_grant_id', type: 'bigint', unsigned: true, nullable: true })
  coverageGrantId!: string | null;

  @Column({ name: 'execution_lease_until', type: 'datetime', nullable: true })
  executionLeaseUntil!: Date | null;

  @Column({ name: 'owner_at_create', type: 'bigint', unsigned: true, nullable: true })
  ownerAtCreate!: string | null;

  @Column({
    type: 'varchar',
    length: 25,
    default: WorkTaskStatus.CREATED,
  })
  status!: WorkTaskStatus;

  @Column({
    type: 'varchar',
    length: 20,
    default: WorkTaskPriority.NORMAL,
  })
  priority!: WorkTaskPriority;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'response_sla_due_at', type: 'datetime', nullable: true })
  responseSlaDueAt!: Date | null;

  @Column({ name: 'resolution_sla_due_at', type: 'datetime', nullable: true })
  resolutionSlaDueAt!: Date | null;

  @Column({ name: 'first_response_at', type: 'datetime', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

