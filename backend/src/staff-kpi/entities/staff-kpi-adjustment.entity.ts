import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AdjustmentStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('staff_kpi_adjustments')
@Index('ix_adjustments_staff_period', ['hotelId', 'staffUserId', 'periodKey'])
export class StaffKpiAdjustment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({ name: 'period_key', type: 'varchar', length: 20 })
  periodKey!: string;

  @Column({ name: 'metric_code', type: 'varchar', length: 50 })
  metricCode!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  delta!: number;

  @Column({ name: 'evidence_ref', type: 'varchar', length: 255, nullable: true })
  evidenceRef!: string | null;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: AdjustmentStatus.REQUESTED,
  })
  status!: AdjustmentStatus;

  @Column({ name: 'requested_by', type: 'bigint', unsigned: true })
  requestedBy!: string;

  @Column({ name: 'reviewed_by', type: 'bigint', unsigned: true, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

