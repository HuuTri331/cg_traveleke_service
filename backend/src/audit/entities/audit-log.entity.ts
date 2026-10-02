import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditAction {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'entity_name',
    type: 'varchar',
    length: 100,
  })
  @Index('idx_audit_entity_name')
  entityName!: string;

  @Column({
    name: 'entity_id',
    type: 'varchar',
    length: 100,
  })
  @Index('idx_audit_entity_id')
  entityId!: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  @Index('idx_audit_action')
  action!: AuditAction;

  @Column({
    name: 'old_values',
    type: 'json',
    nullable: true,
  })
  oldValues!: Record<string, any> | null;

  @Column({
    name: 'new_values',
    type: 'json',
    nullable: true,
  })
  newValues!: Record<string, any> | null;

  @Column({
    name: 'performed_by',
    type: 'varchar',
    length: 100,
    nullable: true,
    default: 'SYSTEM',
  })
  @Index('idx_audit_performed_by')
  performedBy!: string | null;

  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 45,
    nullable: true,
  })
  ipAddress!: string | null;

  @Column({
    name: 'user_agent',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  userAgent!: string | null;

  @Column({
    name: 'request_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  requestId!: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  @Index('idx_audit_created_at')
  createdAt!: Date;
}
