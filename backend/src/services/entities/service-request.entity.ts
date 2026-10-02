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

export enum ServiceRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * ServiceRequest – Yêu cầu dịch vụ từ booking
 * Lifecycle: PENDING → ACCEPTED → ASSIGNED → IN_PROGRESS → COMPLETED → CONFIRMED
 *                                                         ↘ FAILED (→ recovery)
 * Snapshot giá tại thời điểm đặt để tránh tranh chấp.
 */
@Entity('service_requests')
export class ServiceRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId: number;

  @Column({
    name: 'assigned_to',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  assignedTo: number | null;

  // ---- SNAPSHOT tại thời điểm tạo request ----
  @Column({ name: 'service_name', type: 'varchar', length: 200 })
  serviceName: string;

  @Column({
    name: 'unit_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  unitPrice: number;

  @Column({ type: 'smallint', unsigned: true, default: 1 })
  quantity: number;

  @Column({
    name: 'total_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalPrice: number;

  // ---- SCHEDULING ----
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'scheduled_at', type: 'datetime', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'sla_due_at', type: 'datetime', nullable: true })
  slaDueAt: Date | null;

  @Column({ name: 'is_sla_breached', type: 'tinyint', default: 0 })
  isSlaBreahed: boolean;

  // ---- TIMESTAMPS ----
  @Column({ name: 'accepted_at', type: 'datetime', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  // ---- SERVICE FAILURE & RECOVERY ----
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({
    name: 'recovery_action',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  recoveryAction: string | null;

  @Column({
    name: 'recovery_approved_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  recoveryApprovedBy: number | null;

  @Column({
    name: 'recovery_cost',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  recoveryCost: number | null;

  // ---- STATUS ----
  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: ServiceRequestStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => RoomService, (svc: RoomService) => svc.requests)
  @JoinColumn({ name: 'service_id' })
  service: RoomService;
}
