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

export enum ServiceType {
  INCLUDED = 'INCLUDED',
  ADD_ON = 'ADD_ON',
  QUOTA = 'QUOTA',
  MINIBAR = 'MINIBAR',
  OPERATIONAL = 'OPERATIONAL',
}

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

  // ============================================================
  // PHÂN LOẠI DỊCH VỤ (theo tài liệu nghiệp vụ)
  // INCLUDED = bao gồm trong giá
  // ADD_ON   = mua thêm
  // QUOTA    = giới hạn số lần miễn phí
  // MINIBAR  = minibar (cần tồn kho)
  // OPERATIONAL = vận hành không thu phí (dọn phòng, wake-up...)
  // ============================================================
  @Column({ name: 'service_type', type: 'varchar', length: 30, default: 'ADD_ON' })
  serviceType: ServiceType;

  @Column({ name: 'quota_per_booking', type: 'smallint', unsigned: true, nullable: true })
  quotaPerBooking: number | null;

  @Column({ name: 'quota_per_night', type: 'smallint', unsigned: true, nullable: true })
  quotaPerNight: number | null;

  @Column({ name: 'max_quantity', type: 'smallint', unsigned: true, nullable: true })
  maxQuantity: number | null;

  // SLA: thời gian tối đa hoàn tất (phút)
  @Column({ name: 'sla_minutes', type: 'smallint', unsigned: true, nullable: true, default: 30 })
  slaMinutes: number | null;

  // Capacity: số slot phục vụ / giờ (dùng cho Spa, Massage)
  @Column({ name: 'capacity_per_hour', type: 'smallint', unsigned: true, nullable: true })
  capacityPerHour: number | null;

  // Lead time: số giờ phải đặt trước
  @Column({ name: 'lead_time_hours', type: 'tinyint', unsigned: true, default: 0 })
  leadTimeHours: number;

  // Cần phê duyệt Supervisor trước khi thực hiện
  @Column({ name: 'requires_approval', type: 'tinyint', default: 0 })
  requiresApproval: boolean;

  // Bộ phận chịu trách nhiệm
  @Column({ name: 'department_owner', type: 'varchar', length: 60, nullable: true })
  departmentOwner: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ServiceCategory, (cat: ServiceCategory) => cat.services)
  @JoinColumn({ name: 'category_id' })
  category: ServiceCategory;

  @OneToMany(() => ServiceRequest, (req: ServiceRequest) => req.service)
  requests: ServiceRequest[];
}
