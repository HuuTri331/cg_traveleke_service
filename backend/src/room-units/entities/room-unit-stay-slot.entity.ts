import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomUnitStaySlotStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
}

@Entity('room_unit_stay_slots')
export class RoomUnitStaySlot {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'allocation_id', type: 'bigint', unsigned: true })
  allocationId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'unit_id', type: 'bigint', unsigned: true })
  unitId!: string;

  @Column({ name: 'stay_date', type: 'date' })
  stayDate!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: RoomUnitStaySlotStatus.ACTIVE,
  })
  status!: RoomUnitStaySlotStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
