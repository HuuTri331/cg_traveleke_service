import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { StaffAbsenceRequestEvent } from './staff-absence-request-event.entity';

export enum AbsenceRequestType {
  LEAVE = 'LEAVE', // Nghỉ cả ngày hoặc nhiều ngày
  LATE_ARRIVAL = 'LATE_ARRIVAL', // Xin đi muộn
  EARLY_LEAVE = 'EARLY_LEAVE', // Xin về sớm
  SHORT_ABSENCE = 'SHORT_ABSENCE', // Vắng mặt tạm thời giữa giờ
}

export enum AbsenceRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  REVOCATION_REQUESTED = 'REVOCATION_REQUESTED',
  REVOKED = 'REVOKED',
}

@Entity('staff_absence_requests')
export class StaffAbsenceRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({
    name: 'request_type',
    type: 'varchar',
    length: 30,
  })
  requestType!: AbsenceRequestType;

  @Column({ name: 'start_at', type: 'datetime' })
  startAt!: Date;

  @Column({ name: 'end_at', type: 'datetime' })
  endAt!: Date;

  @Column({ name: 'expected_arrival_at', type: 'datetime', nullable: true })
  expectedArrivalAt!: Date | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'contact_info', type: 'varchar', length: 255, nullable: true })
  contactInfo!: string | null;

  @Column({ name: 'evidence_ref', type: 'varchar', length: 255, nullable: true })
  evidenceRef!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: AbsenceRequestStatus.PENDING,
  })
  status!: AbsenceRequestStatus;

  @Column({ name: 'decided_by', type: 'bigint', unsigned: true, nullable: true })
  decidedBy!: string | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote!: string | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;

  @OneToMany(() => StaffAbsenceRequestEvent, (event) => event.request)
  events?: StaffAbsenceRequestEvent[];
}
