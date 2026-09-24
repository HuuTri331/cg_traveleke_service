import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RecoveryType {
  COMPLIMENTARY = 'COMPLIMENTARY',
  WAIVE = 'WAIVE',
  UPGRADE = 'UPGRADE',
  COMPENSATION = 'COMPENSATION',
  APOLOGY = 'APOLOGY',
}

/**
 * ServiceRecoveryLog
 * Ghi nhận mọi hành động service recovery: complimentary, waive, upgrade, bù đắp.
 * Theo tài liệu nghiệp vụ:
 * - Phải có reason cụ thể
 * - Phải có người phê duyệt (theo hạn mức: lễ tân < Supervisor < Manager)
 * - Không được xoá charge tùy ý để "cho nhanh"
 */
@Entity('service_recovery_log')
export class ServiceRecoveryLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({
    name: 'service_request_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  serviceRequestId: number | null;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId: number;

  @Column({ name: 'reported_by', type: 'bigint', unsigned: true })
  reportedBy: number;

  @Column({
    name: 'approved_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  approvedBy: number | null;

  @Column({ name: 'recovery_type', type: 'varchar', length: 30 })
  recoveryType: RecoveryType;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'action_taken', type: 'text' })
  actionTaken: string;

  @Column({
    name: 'cost_incurred',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  costIncurred: number;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
