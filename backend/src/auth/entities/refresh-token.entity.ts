import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RefreshTokenStatus {
  ACTIVE = 'ACTIVE',
  USED = 'USED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  @Index('idx_rf_user_id')
  userId!: string;

  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  @Index('idx_rf_session_id')
  sessionId!: string;

  @Column({ name: 'family_id', type: 'varchar', length: 64 })
  @Index('idx_rf_family_id')
  familyId!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  @Index('idx_rf_token_hash')
  tokenHash!: string;

  @Column({
    name: 'parent_token_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  parentTokenId!: string | null;

  @Column({
    type: 'enum',
    enum: RefreshTokenStatus,
    default: RefreshTokenStatus.ACTIVE,
  })
  status!: RefreshTokenStatus;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'absolute_expires_at', type: 'datetime' })
  absoluteExpiresAt!: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
