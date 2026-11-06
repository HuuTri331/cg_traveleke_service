import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('business_day_closures')
export class BusinessDayClosure {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'business_date', type: 'date' })
  businessDate!: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'OPEN' })
  status!: 'PREVIEW' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'REOPEN_REVIEW';

  @Column({ name: 'rooms_available', type: 'int', unsigned: true, default: 0 })
  roomsAvailable!: number;

  @Column({ name: 'rooms_sold', type: 'int', unsigned: true, default: 0 })
  roomsSold!: number;

  @Column({ name: 'occupancy_rate', type: 'decimal', precision: 6, scale: 2, default: 0 })
  occupancyRate!: number;

  @Column({ name: 'room_revenue_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  roomRevenueVnd!: number;

  @Column({ name: 'service_revenue_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  serviceRevenueVnd!: number;

  @Column({ name: 'verified_payments_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  verifiedPaymentsVnd!: number;

  @Column({ name: 'open_folios_count', type: 'int', unsigned: true, default: 0 })
  openFoliosCount!: number;

  @Column({ name: 'exceptions_json', type: 'json', nullable: true })
  exceptionsJson!: any[] | null;

  @Column({ name: 'snapshot_hash', type: 'char', length: 64, nullable: true })
  snapshotHash!: string | null;

  @Column({ name: 'closed_by', type: 'bigint', unsigned: true, nullable: true })
  closedBy!: string | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, nullable: true })
  commandId!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
