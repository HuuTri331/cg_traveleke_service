import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CoverageGrantStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum CoverageTaskType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
  PRE_ARRIVAL_CONTACT = 'PRE_ARRIVAL_CONTACT',
  SERVICE_RESPONSE = 'SERVICE_RESPONSE',
  COMPLAINT_HANDLE = 'COMPLAINT_HANDLE',
  ALL_SERVICE_TASKS = 'ALL_SERVICE_TASKS',
}

@Entity('booking_coverage_grants')
@Index('ix_coverage_booking_time', ['bookingId', 'startAt', 'endAt'])
@Index('ix_coverage_delegate_status', ['delegateStaffId', 'status'])
export class BookingCoverageGrant {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'principal_staff_id', type: 'bigint', unsigned: true })
  principalStaffId!: string;

  @Column({ name: 'delegate_staff_id', type: 'bigint', unsigned: true })
  delegateStaffId!: string;

  @Column({ name: 'mode', type: 'varchar', length: 30, default: 'TEMPORARY' })
  mode!: 'TEMPORARY';

  @Column({ name: 'start_at', type: 'datetime' })
  startAt!: Date;

  @Column({ name: 'end_at', type: 'datetime' })
  endAt!: Date;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: CoverageGrantStatus.ACTIVE,
  })
  status!: CoverageGrantStatus;

  @Column({ name: 'scope_mode', type: 'varchar', length: 20, default: 'TASK_TYPES' })
  scopeMode!: 'TASK_TYPES' | 'TASK_IDS' | 'BOOKING_TASKS';

  @Column({ name: 'absence_request_id', type: 'bigint', unsigned: true, nullable: true })
  absenceRequestId!: string | null;

  // Explicit manager-approved deadline for tasks accepted before grant expiry.
  @Column({ name: 'completion_deadline', type: 'datetime', nullable: true })
  completionDeadline!: Date | null;

  @Column({ name: 'allowed_task_types', type: 'simple-json' })
  allowedTaskTypes!: string[];

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'command_key', type: 'varchar', length: 128, nullable: true })
  commandKey!: string | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

