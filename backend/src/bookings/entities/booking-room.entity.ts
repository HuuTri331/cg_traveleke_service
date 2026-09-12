import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('booking_rooms')
export class BookingRoom {
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
    name: 'room_id',
    type: 'bigint',
    unsigned: true,
  })
  roomId!: string;

  @Column({
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  quantity!: number;

  @Column({
    name: 'price_per_night',
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  pricePerNight!: string;

  @Column({
    type: 'smallint',
    unsigned: true,
  })
  nights!: number;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
  })
  subtotal!: string;

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