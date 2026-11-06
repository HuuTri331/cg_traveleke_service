import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('room_unit_allocation_events')
export class RoomUnitAllocationEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'allocation_id', type: 'bigint', unsigned: true, nullable: true })
  allocationId!: string | null;

  @Column({ name: 'from_unit_id', type: 'bigint', unsigned: true, nullable: true })
  fromUnitId!: string | null;

  @Column({ name: 'to_unit_id', type: 'bigint', unsigned: true, nullable: true })
  toUnitId!: string | null;

  @Column({ name: 'from_room_type_id', type: 'bigint', unsigned: true, nullable: true })
  fromRoomTypeId!: string | null;

  @Column({ name: 'to_room_type_id', type: 'bigint', unsigned: true, nullable: true })
  toRoomTypeId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: string;

  @Column({ name: 'move_type', type: 'varchar', length: 30, nullable: true })
  moveType!: string | null;

  @Column({ name: 'price_delta_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  priceDeltaVnd!: number;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true })
  actorId!: string;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
