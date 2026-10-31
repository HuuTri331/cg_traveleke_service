import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EvidenceVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

@Entity('guest_work_evidence')
@Index('ix_evidence_task', ['taskId'])
export class GuestWorkEvidence {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'task_id', type: 'bigint', unsigned: true })
  taskId!: string;

  @Column({ name: 'submitted_by', type: 'bigint', unsigned: true })
  submittedBy!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: string;

  @Column({ name: 'storage_ref', type: 'varchar', length: 255 })
  storageRef!: string;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 20,
    default: EvidenceVerificationStatus.PENDING,
  })
  verificationStatus!: EvidenceVerificationStatus;

  @Column({ name: 'verified_by', type: 'bigint', unsigned: true, nullable: true })
  verifiedBy!: string | null;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

