import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum WorkEventType {
  TASK_CREATED = 'TASK_CREATED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_ACCEPTED = 'TASK_ACCEPTED',
  TASK_STARTED = 'TASK_STARTED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_VERIFIED = 'TASK_VERIFIED',
  TASK_HANDOVER_REQUIRED = 'TASK_HANDOVER_REQUIRED',
}

export enum WorkEvidenceType {
  SYSTEM_LOG = 'SYSTEM_LOG',
  MESSAGE = 'MESSAGE',
  CALL_LOG = 'CALL_LOG',
  DOCUMENT = 'DOCUMENT',
  SELF_REPORTED = 'SELF_REPORTED',
}

@Entity('guest_work_events')
@Index('ix_work_events_task', ['taskId', 'occurredAt'])
@Index('ix_work_events_actor', ['actorStaffId', 'occurredAt'])
export class GuestWorkEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'task_id', type: 'bigint', unsigned: true })
  taskId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 20, default: 'USER' })
  actorType!: 'USER' | 'SYSTEM';

  @Column({ name: 'actor_staff_id', type: 'bigint', unsigned: true, nullable: true })
  actorStaffId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 30 })
  eventType!: WorkEventType;

  @Column({ name: 'from_status', type: 'varchar', length: 25, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 25 })
  toStatus!: string;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt!: Date;

  @Column({ name: 'evidence_type', type: 'varchar', length: 30, nullable: true })
  evidenceType!: WorkEvidenceType | null;

  @Column({ name: 'evidence_ref', type: 'varchar', length: 255, nullable: true })
  evidenceRef!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt!: Date;
}

