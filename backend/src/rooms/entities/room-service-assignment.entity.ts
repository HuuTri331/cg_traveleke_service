import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Room } from './room.entity';
import { RoomService } from '../../services/entities/room-service.entity';

@Entity('room_service_assignments')
export class RoomServiceAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'room_id', type: 'bigint', unsigned: true })
  roomId: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId: number;

  @Column({ name: 'is_complimentary', type: 'tinyint', default: 1 })
  isComplimentary: boolean;

  @Column({
    name: 'custom_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  customPrice: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room?: Room;

  @ManyToOne(() => RoomService, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_id' })
  service?: RoomService;
}
