import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomStatus {
  AVAILABLE = 'AVAILABLE',
  UNAVAILABLE = 'UNAVAILABLE',
  MAINTENANCE = 'MAINTENANCE',
}

@Entity({ name: 'rooms' })
export class Room {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'hotel_id',
    type: 'bigint',
    unsigned: true,
  })
  hotelId!: string;

  @Column({
    type: 'varchar',
    length: 150,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 180,
  })
  slug!: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  description!: string | null;

  @Column({
    name: 'price_per_night',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  pricePerNight!: string;

  @Column({
    name: 'check_in_time',
    type: 'time',
    default: '14:00:00',
  })
  checkInTime!: string;

  @Column({
    name: 'check_out_time',
    type: 'time',
    default: '12:00:00',
  })
  checkOutTime!: string;

  @Column({
    name: 'max_adults',
    type: 'tinyint',
    unsigned: true,
    default: 2,
  })
  maxAdults!: number;

  @Column({
    name: 'max_children',
    type: 'tinyint',
    unsigned: true,
    default: 0,
  })
  maxChildren!: number;

  @Column({
    name: 'total_rooms',
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  totalRooms!: number;

  @Column({
    name: 'available_rooms',
    type: 'smallint',
    unsigned: true,
    default: 1,
  })
  availableRooms!: number;

  @Column({
    name: 'bed_count',
    type: 'tinyint',
    unsigned: true,
    default: 1,
  })
  bedCount!: number;

  @Column({
    name: 'bed_type',
    type: 'varchar',
    length: 100,
    default: 'Giường Đôi',
  })
  bedType!: string;

  @Column({
    name: 'room_size',
    type: 'smallint',
    unsigned: true,
    nullable: true,
  })
  roomSize!: number | null;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: '5.00',
  })
  rating!: string;

  @Column({
    name: 'review_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  reviewCount!: number;

  @Column({
    name: 'cover_image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  coverImageUrl!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: RoomStatus.AVAILABLE,
  })
  status!: RoomStatus;

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

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    nullable: true,
  })
  deletedAt!: Date | null;

  @OneToMany('RoomImage', 'room')
  images?: any[];
}
