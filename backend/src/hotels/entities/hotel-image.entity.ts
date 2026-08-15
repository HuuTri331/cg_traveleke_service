import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Hotel } from './hotel.entity';

@Entity({ name: 'hotel_images' })
export class HotelImage {
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
    name: 'image_url',
    type: 'varchar',
    length: 500,
  })
  imageUrl!: string;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  caption!: string | null;

  @Column({
    name: 'sort_order',
    type: 'smallint',
    unsigned: true,
    default: 0,
  })
  sortOrder!: number;

  @Column({
    name: 'is_primary',
    type: 'tinyint',
    default: 0,
  })
  isPrimary!: number;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;

  @ManyToOne(() => Hotel, (hotel) => hotel.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hotel_id' })
  hotel?: Hotel;
}
