import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceType } from './room-service.entity';

/**
 * BookingServiceSnapshot
 * Snapshot quyền lợi dịch vụ tại thời điểm booking được xác nhận.
 * Theo tài liệu nghiệp vụ: "ngay khi booking confirmed phải tạo bản chụp quyền lợi"
 * Đảm bảo khách tranh chấp sau vẫn có bằng chứng họ đã mua/được gì.
 */
@Entity('booking_service_snapshots')
export class BookingServiceSnapshot {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId: number;

  // ---- SNAPSHOT DATA (chụp tại thời điểm confirm booking) ----
  @Column({ name: 'service_name', type: 'varchar', length: 200 })
  serviceName: string;

  @Column({ name: 'service_type', type: 'varchar', length: 30, default: ServiceType.INCLUDED })
  serviceType: ServiceType;

  @Column({ name: 'category_name', type: 'varchar', length: 150, nullable: true })
  categoryName: string | null;

  @Column({ type: 'varchar', length: 50, default: 'lần' })
  unit: string;

  @Column({ name: 'base_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  basePrice: number;

  @Column({ name: 'is_complimentary', type: 'tinyint', default: 0 })
  isComplimentary: boolean;

  // ---- QUOTA TRACKING ----
  @Column({ name: 'quota_included', type: 'smallint', unsigned: true, nullable: true })
  quotaIncluded: number | null;

  @Column({ name: 'quota_used', type: 'smallint', unsigned: true, default: 0 })
  quotaUsed: number;

  @Column({ name: 'quota_per_night', type: 'smallint', unsigned: true, nullable: true })
  quotaPerNight: number | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status: 'ACTIVE' | 'WAIVED' | 'FORFEITED';

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
