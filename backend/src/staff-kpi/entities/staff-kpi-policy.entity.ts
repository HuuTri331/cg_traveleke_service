import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('staff_kpi_policies')
export class StaffKpiPolicy {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true, nullable: true })
  hotelId!: string | null;

  @Column({ name: 'policy_version', type: 'varchar', length: 20, default: 'v1.0' })
  policyVersion!: string;

  @Column({ name: 'effective_from', type: 'datetime' })
  effectiveFrom!: Date;

  @Column({ name: 'weights_json', type: 'simple-json' })
  weightsJson!: Record<string, number>;

  @Column({ name: 'sla_rules_json', type: 'simple-json', nullable: true })
  slaRulesJson!: Record<string, any> | null;

  @Column({ name: 'min_sample_json', type: 'simple-json', nullable: true })
  minSampleJson!: Record<string, number> | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'ARCHIVED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

