import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('booking_assignment_command_receipts')
export class BookingAssignmentCommandReceipt {
  @PrimaryColumn({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @PrimaryColumn({ name: 'command_key', type: 'varchar', length: 120 })
  commandKey!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string; // SUCCESS, FAILED, SKIPPED

  @Column({ type: 'int', unsigned: true, default: 1 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'processed_at', type: 'datetime' })
  processedAt!: Date;
}
