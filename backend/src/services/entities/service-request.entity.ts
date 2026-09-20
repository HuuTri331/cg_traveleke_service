import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RoomService } from './room-service.entity';

@Entity('service_requests')
export class ServiceRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId: number;

  @Column({ name: 'assigned_to', type: 'bigint', unsigned: true, nullable: true })
  assignedTo: number | null;

  // Snapshot tại thời điểm đặt
  @Column({ name: 'service_name', type: 'varchar', length: 200 })
  serviceName: string;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'smallint', unsigned: true, default: 1 })
  quantity: number;

  @Column({ name: 'total_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalPrice: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'scheduled_at', type: 'datetime', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => RoomService, (svc) => svc.requests)
  @JoinColumn({ name: 'service_id' })
  service: RoomService;
}
