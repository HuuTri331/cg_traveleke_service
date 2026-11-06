import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum HousekeepingTaskKind {
  CHECKOUT_CLEAN = 'CHECKOUT_CLEAN',
  STAYOVER_CLEAN = 'STAYOVER_CLEAN',
  DEEP_CLEAN = 'DEEP_CLEAN',
  ROOM_MOVE_CLEAN = 'ROOM_MOVE_CLEAN',
}

export enum HousekeepingTaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  CLEANED = 'CLEANED',
  INSPECTED_READY = 'INSPECTED_READY',
  ISSUE_REPORTED = 'ISSUE_REPORTED',
  CANCELLED = 'CANCELLED',
}

@Entity('housekeeping_tasks')
export class HousekeepingTask {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'unit_id', type: 'bigint', unsigned: true })
  unitId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, nullable: true })
  bookingId!: string | null;

  @Column({ name: 'next_arrival_booking_id', type: 'bigint', unsigned: true, nullable: true })
  nextArrivalBookingId!: string | null;

  @Column({
    name: 'kind',
    type: 'varchar',
    length: 30,
    default: HousekeepingTaskKind.CHECKOUT_CLEAN,
  })
  kind!: HousekeepingTaskKind;

  @Column({ name: 'priority', type: 'varchar', length: 20, default: 'NORMAL' })
  priority!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: HousekeepingTaskStatus.OPEN,
  })
  status!: HousekeepingTaskStatus;

  @Column({ name: 'assigned_to', type: 'bigint', unsigned: true, nullable: true })
  assignedTo!: string | null;

  @Column({ name: 'cleaned_by', type: 'bigint', unsigned: true, nullable: true })
  cleanedBy!: string | null;

  @Column({ name: 'inspector_id', type: 'bigint', unsigned: true, nullable: true })
  inspectorId!: string | null;

  @Column({ name: 'due_at', type: 'datetime' })
  dueAt!: Date;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'cleaned_at', type: 'datetime', nullable: true })
  cleanedAt!: Date | null;

  @Column({ name: 'inspected_at', type: 'datetime', nullable: true })
  inspectedAt!: Date | null;

  @Column({ name: 'checklist_json', type: 'json', nullable: true })
  checklistJson!: Record<string, any> | null;

  @Column({ name: 'issue_note', type: 'text', nullable: true })
  issueNote!: string | null;

  @Column({ name: 'source_event_key', type: 'varchar', length: 120, unique: true })
  sourceEventKey!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
