import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('booking_status_logs')
export class BookingStatusLog {
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
    name: 'changed_by',
    type: 'bigint',
    unsigned: true,
  })
  changedBy!: string;

  @Column({
    name: 'old_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  oldStatus!: string | null;

  @Column({
    name: 'new_status',
    type: 'varchar',
    length: 30,
  })
  newStatus!: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  note!: string | null;

  @Column({
    name: 'changed_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  changedAt!: Date;
}
