import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Room } from './room.entity';

@Entity({ name: 'room_images' })
export class RoomImage {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'room_id',
    type: 'bigint',
    unsigned: true,
  })
  roomId!: string;

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

  @ManyToOne(() => Room, (room) => room.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'room_id' })
  room?: Room;
}
