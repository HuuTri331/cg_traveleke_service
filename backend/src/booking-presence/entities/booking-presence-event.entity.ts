import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PresenceEventType {
  ARRIVAL_CONFIRMED = 'ARRIVAL_CONFIRMED',
  NO_SHOW_MARKED = 'NO_SHOW_MARKED',
  LATE_CHECK_IN_RECOVERED = 'LATE_CHECK_IN_RECOVERED',
  DEPARTURE_CONFIRMED = 'DEPARTURE_CONFIRMED',
  NO_SHOW_CLOSED = 'NO_SHOW_CLOSED',
  LATE_ARRIVAL_NOTICED = 'LATE_ARRIVAL_NOTICED',
}

export enum PresenceActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

@Entity('booking_presence_events')
@Index(['bookingId', 'occurredAt'])
@Index(['hotelId', 'eventType'])
export class BookingPresenceEvent {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'booking_id',
    type: 'bigint',
    unsigned: true,
  })
  bookingId!: string;

  @Column({
    name: 'hotel_id',
    type: 'bigint',
    unsigned: true,
  })
  hotelId!: string;

  @Column({
    name: 'from_status',
    type: 'varchar',
    length: 30,
  })
  fromStatus!: string;

  @Column({
    name: 'to_status',
    type: 'varchar',
    length: 30,
  })
  toStatus!: string;

  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: PresenceActorType,
    default: PresenceActorType.USER,
  })
  actorType!: PresenceActorType;

  @Column({
    name: 'actor_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  actorId!: string | null;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 50,
  })
  eventType!: PresenceEventType;

  @Column({
    name: 'late_minutes',
    type: 'int',
    nullable: true,
  })
  lateMinutes!: number | null;

  @Column({
    type: 'text',
    nullable: true,
  })
  reason!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({
    name: 'occurred_at',
    type: 'datetime',
  })
  occurredAt!: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;
}
