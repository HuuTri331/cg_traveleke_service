import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TrackingEventType {
  VIEW_DETAIL = 'VIEW_DETAIL',
  SEARCH = 'SEARCH',
}

@Entity({ name: 'hotel_tracking_events' })
@Index(['ipAddress', 'viewedAt'])
@Index(['hotelId', 'viewedAt'])
@Index(['viewedAt'])
export class HotelTrackingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: number;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: TrackingEventType,
    default: TrackingEventType.VIEW_DETAIL,
  })
  eventType!: TrackingEventType;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId?: number | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress!: string;

  @Column({
    name: 'price_min',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  priceMin?: number | null;

  @Column({
    name: 'price_max',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  priceMax?: number | null;

  @CreateDateColumn({ name: 'viewed_at' })
  viewedAt!: Date;
}
