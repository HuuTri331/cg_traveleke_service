import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum PromotionCampaignType {
  STAY_DATE = 'STAY_DATE',
  SERVICE_TIME = 'SERVICE_TIME',
  SEASONAL_EVENT = 'SEASONAL_EVENT',
  FAMILY_PACKAGE = 'FAMILY_PACKAGE',
  GROUP_PACKAGE = 'GROUP_PACKAGE',
  LONG_STAY = 'LONG_STAY',
  EARLY_BIRD = 'EARLY_BIRD',
  LAST_MINUTE = 'LAST_MINUTE',
  COUPON = 'COUPON',
  LOYALTY = 'LOYALTY',
  OCCUPANCY = 'OCCUPANCY',
  SERVICE_CREDIT = 'SERVICE_CREDIT',
  PLATFORM_CAMPAIGN = 'PLATFORM_CAMPAIGN',
}

export enum PromotionCampaignStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
  EXHAUSTED = 'EXHAUSTED',
  CANCELLED_BEFORE_START = 'CANCELLED_BEFORE_START',
  CANCELLED_WITH_REMEDIATION = 'CANCELLED_WITH_REMEDIATION',
  ARCHIVED = 'ARCHIVED',
  REJECTED = 'REJECTED',
}

export enum ChargeComponentType {
  ROOM_NIGHT = 'ROOM_NIGHT',
  SERVICE_ITEM = 'SERVICE_ITEM',
  PACKAGE_COMPONENT = 'PACKAGE_COMPONENT',
  INDEPENDENT_BENEFIT = 'INDEPENDENT_BENEFIT',
}

export enum PromotionTargetScope {
  ALL_ROOMS = 'ALL_ROOMS',
  ROOM_IDS = 'ROOM_IDS',
  ALL_SERVICES = 'ALL_SERVICES',
  SERVICE_IDS = 'SERVICE_IDS',
}

export enum PromotionDiscountType {
  PERCENT = 'PERCENT',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  SERVICE_CREDIT = 'SERVICE_CREDIT',
  PACKAGE_FIXED = 'PACKAGE_FIXED',
}

export enum BenefitKind {
  ROOM_PRICE_ADJUSTMENT = 'ROOM_PRICE_ADJUSTMENT',
  SERVICE_BENEFIT_CREDIT = 'SERVICE_BENEFIT_CREDIT',
  INCLUDED_QUOTA = 'INCLUDED_QUOTA',
}
@Entity('promotion_campaigns')
@Index('ux_promo_hotel_code_ver', ['hotelId', 'code', 'version'], { unique: true })
@Index('ix_promo_hotel_status_dates', ['hotelId', 'status', 'stayStartDate', 'stayEndExclusiveDate'])
export class PromotionCampaign {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: string;
  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true }) hotelId!: string;
  @Column({ type: 'varchar', length: 60 }) code!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'campaign_type', type: 'varchar', length: 40, default: PromotionCampaignType.STAY_DATE })
  campaignType!: PromotionCampaignType;
  @Column({ type: 'varchar', length: 30, default: PromotionCampaignStatus.DRAFT })
  status!: PromotionCampaignStatus;
  @Column({ name: 'charge_component_type', type: 'varchar', length: 30, default: ChargeComponentType.ROOM_NIGHT })
  chargeComponentType!: ChargeComponentType;
  @Column({ name: 'target_scope', type: 'varchar', length: 30, default: PromotionTargetScope.ROOM_IDS })
  targetScope!: PromotionTargetScope;
  @Column({ name: 'target_room_ids_json', type: 'simple-json', nullable: true }) targetRoomIds!: string[] | null;
  @Column({ name: 'target_service_ids_json', type: 'simple-json', nullable: true }) targetServiceIds!: string[] | null;
  @Column({ name: 'stay_start_date', type: 'varchar', length: 10 }) stayStartDate!: string;
  @Column({ name: 'stay_end_exclusive_date', type: 'varchar', length: 10 }) stayEndExclusiveDate!: string;
  @Column({ name: 'bookable_start_at', type: 'datetime', nullable: true }) bookableStartAt!: Date | null;
  @Column({ name: 'bookable_end_at', type: 'datetime', nullable: true }) bookableEndAt!: Date | null;
  @Column({ name: 'service_start_hour', type: 'tinyint', unsigned: true, nullable: true }) serviceStartHour!: number | null;
  @Column({ name: 'service_end_hour', type: 'tinyint', unsigned: true, nullable: true }) serviceEndHour!: number | null;
  @Column({ name: 'discount_type', type: 'varchar', length: 30, default: PromotionDiscountType.FIXED_AMOUNT })
  discountType!: PromotionDiscountType;
  @Column({ name: 'discount_value', type: 'decimal', precision: 15, scale: 2, default: 0 }) discountValue!: number;
  @Column({ name: 'floor_price', type: 'decimal', precision: 15, scale: 2, default: 0 }) floorPrice!: number;
  @Column({ name: 'max_discount_per_night', type: 'decimal', precision: 15, scale: 2, nullable: true }) maxDiscountPerNight!: number | null;
  @Column({ name: 'max_discount_per_booking', type: 'decimal', precision: 15, scale: 2, nullable: true }) maxDiscountPerBooking!: number | null;
  @Column({ name: 'min_nights', type: 'smallint', unsigned: true, default: 1 }) minNights!: number;
  @Column({ name: 'min_rooms', type: 'smallint', unsigned: true, default: 1 }) minRooms!: number;
  @Column({ name: 'min_guests', type: 'smallint', unsigned: true, default: 1 }) minGuests!: number;
  @Column({ name: 'min_order_amount', type: 'decimal', precision: 15, scale: 2, default: 0 }) minOrderAmount!: number;
  @Column({ name: 'benefit_kind', type: 'varchar', length: 40, default: BenefitKind.ROOM_PRICE_ADJUSTMENT }) benefitKind!: BenefitKind;
  @Column({ name: 'existing_bookings_eligible', type: 'boolean', default: true }) existingBookingsEligible!: boolean;
  @Column({ name: 'retroactive_mode', type: 'boolean', default: false }) retroactiveMode!: boolean;
  @Column({ name: 'combinability_policy', type: 'varchar', length: 20, default: 'EXCLUSIVE' })
  combinabilityPolicy!: 'EXCLUSIVE' | 'COMBINABLE_INDEPENDENT';
  @Column({ name: 'sponsor_type', type: 'varchar', length: 20, default: 'HOTEL' })
  sponsorType!: 'HOTEL' | 'PLATFORM' | 'CO_FUNDED';
  @Column({ name: 'hotel_timezone', type: 'varchar', length: 50, default: 'Asia/Ho_Chi_Minh' }) hotelTimezone!: string;
  @Column({ name: 'budget_total', type: 'decimal', precision: 15, scale: 2, nullable: true }) budgetTotal!: number | null;
  @Column({ name: 'budget_reserved', type: 'decimal', precision: 15, scale: 2, default: 0 }) budgetReserved!: number;
  @Column({ name: 'budget_consumed', type: 'decimal', precision: 15, scale: 2, default: 0 }) budgetConsumed!: number;
  @Column({ name: 'budget_reversed', type: 'decimal', precision: 15, scale: 2, default: 0 }) budgetReversed!: number;
  @Column({ name: 'max_redemptions', type: 'int', unsigned: true, nullable: true }) maxRedemptions!: number | null;
  @Column({ name: 'redemptions_count', type: 'int', unsigned: true, default: 0 }) redemptionsCount!: number;
  @Column({ name: 'package_config_json', type: 'simple-json', nullable: true })
  packageConfig!: {
    includedQuotas?: Array<{ serviceCode: string; serviceName: string; quantity: number }>;
    roomPriceDiscountPercent?: number;
    allocatedRoomIds?: string[];
  } | null;
  @Column({ type: 'int', unsigned: true, default: 1 }) version!: number;
  @Column({ name: 'created_by', type: 'bigint', unsigned: true }) createdBy!: string;
  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'datetime', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'published_at', type: 'datetime', nullable: true }) publishedAt!: Date | null;
  @Column({ name: 'paused_reason', type: 'varchar', length: 255, nullable: true }) pausedReason!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}

