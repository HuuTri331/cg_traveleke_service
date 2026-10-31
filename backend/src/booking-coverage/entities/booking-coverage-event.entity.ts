import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum CoverageEventType {
  GRANT_CREATED = 'GRANT_CREATED',
  GRANT_EXTENDED = 'GRANT_EXTENDED',
  GRANT_REVOKED = 'GRANT_REVOKED',
  GRANT_EXPIRED = 'GRANT_EXPIRED',
  PERMANENT_TRANSFER = 'PERMANENT_TRANSFER',
}

@Entity('booking_coverage_events')
@Index('ix_coverage_events_booking', ['bookingId', 'occurredAt'])
export class BookingCoverageEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'grant_id', type: 'bigint', unsigned: true, nullable: true })
  grantId!: string | null;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 30,
  })
  eventType!: CoverageEventType;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true, nullable: true })
  actorId!: string | null;

  @Column({ name: 'old_value', type: 'simple-json', nullable: true })
  oldValue!: any;

  @Column({ name: 'new_value', type: 'simple-json', nullable: true })
  newValue!: any;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt!: Date;
}

