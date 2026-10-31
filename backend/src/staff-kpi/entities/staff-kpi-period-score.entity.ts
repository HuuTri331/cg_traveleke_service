import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { StaffKpiMetricScore } from './staff-kpi-metric-score.entity';

export enum KpiPeriodStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  LOCKED = 'LOCKED',
}

@Entity('staff_kpi_period_scores')
@Index('ux_kpi_period_staff_calc', ['hotelId', 'staffUserId', 'periodKey', 'calculationVersion'], { unique: true })
@Index('ix_kpi_hotel_period', ['hotelId', 'periodKey'])
export class StaffKpiPeriodScore {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({ name: 'period_key', type: 'varchar', length: 20 })
  periodKey!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 20, default: 'v1.0' })
  policyVersion!: string;

  @Column({ name: 'calculation_version', type: 'int', unsigned: true, default: 1 })
  calculationVersion!: number;

  @Column({ name: 'total_score', type: 'decimal', precision: 5, scale: 2, default: 0 })
  totalScore!: number;

  @Column({ name: 'coverage_ratio', type: 'decimal', precision: 5, scale: 2, default: 100 })
  coverageRatio!: number;

  @Column({ name: 'sample_count', type: 'int', unsigned: true, default: 0 })
  sampleCount!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: KpiPeriodStatus.DRAFT,
  })
  status!: KpiPeriodStatus;

  @Column({ name: 'source_hash', type: 'varchar', length: 64, nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'calculated_at', type: 'datetime' })
  calculatedAt!: Date;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'review_note', type: 'varchar', length: 255, nullable: true })
  reviewNote!: string | null;

  @OneToMany(() => StaffKpiMetricScore, (metric) => metric.periodScore, { cascade: true })
  metrics!: StaffKpiMetricScore[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

