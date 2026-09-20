import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ServiceCategory } from './service-category.entity';
import { ServiceRequest } from './service-request.entity';

@Entity('room_services')
export class RoomService {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId: number;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true, nullable: true })
  hotelId: number | null;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true, nullable: true })
  roomTypeId: number | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50, default: 'lần' })
  unit: string;

  @Column({ name: 'base_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  basePrice: number;

  @Column({ name: 'is_complimentary', type: 'tinyint', default: 0 })
  isComplimentary: boolean;

  @Column({ name: 'max_quantity', type: 'smallint', unsigned: true, nullable: true })
  maxQuantity: number | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ServiceCategory, (cat) => cat.services)
  @JoinColumn({ name: 'category_id' })
  category: ServiceCategory;

  @OneToMany(() => ServiceRequest, (req) => req.service)
  requests: ServiceRequest[];
}
