import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rate_plans')
export class RatePlan {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'meal_plan', type: 'varchar', length: 30, default: 'ROOM_ONLY' })
  mealPlan!: string;

  @Column({ name: 'is_refundable', type: 'tinyint', width: 1, default: 1 })
  isRefundable!: boolean;

  @Column({ name: 'cancellation_policy_id', type: 'bigint', unsigned: true, nullable: true })
  cancellationPolicyId!: string | null;

  @Column({ name: 'base_occupancy', type: 'smallint', unsigned: true, default: 2 })
  baseOccupancy!: number;

  @Column({ name: 'extra_adult_fee_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  extraAdultFeeVnd!: number;

  @Column({ name: 'extra_child_fee_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  extraChildFeeVnd!: number;

  @Column({ name: 'floor_price_vnd', type: 'decimal', precision: 15, scale: 2, default: 100000 })
  floorPriceVnd!: number;

  @Column({ name: 'ceiling_price_vnd', type: 'decimal', precision: 15, scale: 2, nullable: true })
  ceilingPriceVnd!: number | null;

  @Column({ name: 'priority', type: 'int', default: 100 })
  priority!: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('rate_calendar')
export class RateCalendar {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'rate_plan_id', type: 'bigint', unsigned: true })
  ratePlanId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'stay_date', type: 'date' })
  stayDate!: string;

  @Column({ name: 'base_vnd', type: 'decimal', precision: 15, scale: 2 })
  baseVnd!: number;

  @Column({ name: 'adjustment_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  adjustmentVnd!: number;

  @Column({ name: 'minimum_nights', type: 'smallint', unsigned: true, default: 1 })
  minimumNights!: number;

  @Column({ name: 'closed', type: 'tinyint', width: 1, default: 0 })
  closed!: boolean;

  @Column({ name: 'season_label', type: 'varchar', length: 60, nullable: true })
  seasonLabel!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
