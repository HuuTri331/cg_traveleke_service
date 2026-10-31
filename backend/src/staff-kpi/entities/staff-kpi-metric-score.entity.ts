import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StaffKpiPeriodScore } from './staff-kpi-period-score.entity';

@Entity('staff_kpi_metric_scores')
@Index('ix_metric_period_score', ['periodScoreId'])
export class StaffKpiMetricScore {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'period_score_id', type: 'bigint', unsigned: true })
  periodScoreId!: string;

  @ManyToOne(() => StaffKpiPeriodScore, (score) => score.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'period_score_id' })
  periodScore!: StaffKpiPeriodScore;

  @Column({ name: 'metric_code', type: 'varchar', length: 50 })
  metricCode!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  weight!: number;

  @Column({ type: 'boolean', default: true })
  eligible!: boolean;

  @Column({ type: 'int', unsigned: true, default: 0 })
  numerator!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  denominator!: number;

  @Column({ name: 'raw_value', type: 'decimal', precision: 5, scale: 2, default: 0 })
  rawValue!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  score!: number;

  @Column({ name: 'evidence_count', type: 'int', unsigned: true, default: 0 })
  evidenceCount!: number;

  @Column({ name: 'no_data_reason', type: 'varchar', length: 255, nullable: true })
  noDataReason!: string | null;
}

