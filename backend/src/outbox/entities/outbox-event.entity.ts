import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'event_type',
    length: 100,
  })
  eventType!: string;

  @Column({
    name: 'aggregate_type',
    length: 50,
  })
  aggregateType!: string;

  @Column({
    name: 'aggregate_id',
    length: 50,
  })
  aggregateId!: string;

  @Column({
    type: 'json',
  })
  payload!: any;

  @Column({
    type: 'varchar',
    length: 30,
    default: OutboxEventStatus.PENDING,
  })
  status!: OutboxEventStatus;

  @Column({
    name: 'retry_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  retryCount!: number;

  @Column({
    name: 'max_retries',
    type: 'int',
    unsigned: true,
    default: 5,
  })
  maxRetries!: number;

  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
  })
  errorMessage!: string | null;

  @Column({
    name: 'available_at',
    type: 'datetime',
  })
  availableAt!: Date;

  @Column({
    name: 'processed_at',
    type: 'datetime',
    nullable: true,
  })
  processedAt!: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
  })
  updatedAt!: Date;
}
