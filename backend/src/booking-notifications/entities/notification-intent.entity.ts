import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notification_intents')
export class NotificationIntent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, nullable: true })
  bookingId!: string | null;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'source_event_id', type: 'varchar', length: 120 })
  sourceEventId!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 60 })
  templateKey!: string;

  @Column({ name: 'template_version', type: 'smallint', unsigned: true, default: 1 })
  templateVersion!: number;

  @Column({ name: 'channel', type: 'varchar', length: 20, default: 'EMAIL' })
  channel!: 'EMAIL' | 'IN_APP' | 'SMS';

  @Column({ name: 'recipient_key', type: 'varchar', length: 180 })
  recipientKey!: string;

  @Column({ name: 'payload_json', type: 'json' })
  payloadJson!: Record<string, any>;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'QUEUED' })
  status!: 'QUEUED' | 'DELIVERED' | 'FAILED_RETRYABLE' | 'DEAD_LETTER';

  @Column({ name: 'retry_count', type: 'tinyint', unsigned: true, default: 0 })
  retryCount!: number;

  @Column({ name: 'last_error', type: 'varchar', length: 255, nullable: true })
  lastError!: string | null;

  @Column({ name: 'delivered_at', type: 'datetime', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'command_key', type: 'varchar', length: 120 })
  commandKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('notification_deliveries')
export class NotificationDelivery {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'intent_id', type: 'bigint', unsigned: true })
  intentId!: string;

  @Column({ name: 'attempt_no', type: 'tinyint', unsigned: true, default: 1 })
  attemptNo!: number;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status!: 'DELIVERED' | 'FAILED';

  @Column({ name: 'provider_ref', type: 'varchar', length: 120, nullable: true })
  providerRef!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 255, nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'delivered_at', type: 'datetime', nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
