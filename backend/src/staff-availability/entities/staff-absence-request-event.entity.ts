import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StaffAbsenceRequest } from './staff-absence-request.entity';

@Entity('staff_absence_request_events')
export class StaffAbsenceRequestEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'request_id', type: 'bigint', unsigned: true })
  requestId!: string;

  @Column({ name: 'old_status', type: 'varchar', length: 30, nullable: true })
  oldStatus!: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 30 })
  newStatus!: string;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true })
  actorId!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'datetime' })
  occurredAt!: Date;

  @ManyToOne(() => StaffAbsenceRequest, (request) => request.events, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request?: StaffAbsenceRequest;
}
