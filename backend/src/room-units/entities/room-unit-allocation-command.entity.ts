import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('room_unit_allocation_commands')
@Index('uq_booking_allocation_command', ['bookingId', 'commandKey'], { unique: true })
export class RoomUnitAllocationCommand {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'command_key', type: 'varchar', length: 128 })
  commandKey!: string;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true })
  actorUserId!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'result_json', type: 'json', nullable: true })
  resultJson!: any | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
