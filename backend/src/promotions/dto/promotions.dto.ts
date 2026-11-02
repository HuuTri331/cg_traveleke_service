import {
  IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min,
} from 'class-validator';
import {
  BenefitKind, ChargeComponentType, PromotionCampaignType, PromotionDiscountType, PromotionTargetScope,
} from '../entities/promotion-campaign.entity';

export class CreatePromotionCampaignDto {
  @IsString() @IsNotEmpty() hotelId!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PromotionCampaignType) @IsOptional() campaignType?: PromotionCampaignType;
  @IsEnum(ChargeComponentType) @IsOptional() chargeComponentType?: ChargeComponentType;
  @IsEnum(PromotionTargetScope) @IsOptional() targetScope?: PromotionTargetScope;
  @IsArray() @IsOptional() targetRoomIds?: string[];
  @IsArray() @IsOptional() targetServiceIds?: string[];
  @IsString() @IsNotEmpty() stayStartDate!: string; // YYYY-MM-DD
  // Supports either stayEndExclusiveDate or inclusive stayEndDate (normalized to +1 day)
  @IsString() @IsOptional() stayEndExclusiveDate?: string;
  @IsString() @IsOptional() stayEndDate?: string;
  @IsNumber() @IsOptional() serviceStartHour?: number;
  @IsNumber() @IsOptional() serviceEndHour?: number;
  @IsEnum(PromotionDiscountType) @IsOptional() discountType?: PromotionDiscountType;
  @IsNumber() @Min(0) discountValue!: number;
  @IsNumber() @Min(0) @IsOptional() floorPrice?: number;
  @IsNumber() @Min(0) @IsOptional() maxDiscountPerNight?: number;
  @IsNumber() @Min(0) @IsOptional() maxDiscountPerBooking?: number;
  @IsNumber() @Min(1) @IsOptional() minNights?: number;
  @IsNumber() @Min(1) @IsOptional() minRooms?: number;
  @IsNumber() @Min(1) @IsOptional() minGuests?: number;
  @IsNumber() @Min(0) @IsOptional() minOrderAmount?: number;
  @IsEnum(BenefitKind) @IsOptional() benefitKind?: BenefitKind;
  @IsBoolean() @IsOptional() existingBookingsEligible?: boolean;
  @IsBoolean() @IsOptional() retroactiveMode?: boolean;
  @IsNumber() @Min(0) @IsOptional() budgetTotal?: number;
  @IsNumber() @Min(1) @IsOptional() maxRedemptions?: number;
  @IsOptional() packageConfig?: {
    includedQuotas?: Array<{ serviceCode: string; serviceName: string; quantity: number }>;
    roomPriceDiscountPercent?: number;
    allocatedRoomIds?: string[];
  };
}

export class CalculateQuoteDto {
  @IsString() @IsNotEmpty() roomId!: string;
  @IsString() @IsNotEmpty() checkInAt!: string;
  @IsString() @IsNotEmpty() checkOutAt!: string;
  @IsNumber() @Min(1) @IsOptional() roomCount?: number;
  @IsNumber() @Min(1) @IsOptional() totalGuests?: number;
}

export class RedeemBenefitDto {
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsNumber() @Min(0) @IsOptional() requestedAmount?: number;
  @IsNumber() @Min(0) @IsOptional() requestedQuota?: number;
  @IsString() @IsOptional() serviceRequestId?: string;
  @IsString() @IsOptional() serviceId?: string;
  @IsString() @IsNotEmpty() idempotencyKey!: string;
  @IsString() @IsOptional() reason?: string;
  @IsBoolean() @IsOptional() customerAgreedToOffset?: boolean;
}
