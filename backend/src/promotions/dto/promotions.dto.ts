import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BenefitKind,
  ChargeComponentType,
  PromotionCampaignType,
  PromotionDiscountType,
  PromotionTargetScope,
} from '../entities/promotion-campaign.entity';

export class IncludedQuotaItemDto {
  @IsString() @IsNotEmpty() serviceCode!: string;
  @IsString() @IsNotEmpty() serviceName!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class PackageConfigDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncludedQuotaItemDto)
  includedQuotas?: IncludedQuotaItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  roomPriceDiscountPercent?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allocatedRoomIds?: string[];
}

export class CreatePromotionCampaignDto {
  @IsString() @IsNotEmpty() hotelId!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PromotionCampaignType) @IsOptional() campaignType?: PromotionCampaignType;
  @IsEnum(ChargeComponentType) @IsOptional() chargeComponentType?: ChargeComponentType;
  @IsEnum(PromotionTargetScope) @IsOptional() targetScope?: PromotionTargetScope;
  @IsArray() @IsString({ each: true }) @IsOptional() targetRoomIds?: string[];
  @IsArray() @IsString({ each: true }) @IsOptional() targetServiceIds?: string[];
  @IsString() @IsNotEmpty() stayStartDate!: string;
  @IsString() @IsOptional() stayEndExclusiveDate?: string;
  @IsString() @IsOptional() stayEndDate?: string;
  @IsInt() @Min(0) @Max(24) @IsOptional() serviceStartHour?: number;
  @IsInt() @Min(0) @Max(24) @IsOptional() serviceEndHour?: number;
  @IsEnum(PromotionDiscountType) @IsOptional() discountType?: PromotionDiscountType;
  @IsNumber() @Min(0) discountValue!: number;
  @IsNumber() @Min(0) @IsOptional() floorPrice?: number;
  @IsNumber() @Min(0) @IsOptional() maxDiscountPerNight?: number;
  @IsNumber() @Min(0) @IsOptional() maxDiscountPerBooking?: number;
  @IsInt() @Min(1) @IsOptional() minNights?: number;
  @IsInt() @Min(1) @IsOptional() minRooms?: number;
  @IsInt() @Min(1) @IsOptional() minGuests?: number;
  @IsNumber() @Min(0) @IsOptional() minOrderAmount?: number;
  @IsEnum(BenefitKind) @IsOptional() benefitKind?: BenefitKind;
  @IsBoolean() @IsOptional() existingBookingsEligible?: boolean;
  @IsBoolean() @IsOptional() retroactiveMode?: boolean;
  @IsNumber() @Min(0) @IsOptional() budgetTotal?: number;
  @IsInt() @Min(1) @IsOptional() maxRedemptions?: number;
  @IsOptional()
  @ValidateNested()
  @Type(() => PackageConfigDto)
  packageConfig?: PackageConfigDto;
}

export class CalculateQuoteDto {
  @IsString() @IsNotEmpty() roomId!: string;
  @IsString() @IsNotEmpty() checkInAt!: string;
  @IsString() @IsNotEmpty() checkOutAt!: string;
  @IsNumber() @Min(1) @IsOptional() roomCount?: number;
  @IsNumber() @Min(1) @IsOptional() totalGuests?: number;
}

export class AcceptConsentDto {
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() termsVersion?: string;
  @IsOptional() @IsString() evidenceRef?: string;
}

export class RedeemBenefitDto {
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsString() @IsNotEmpty() serviceRequestId!: string;
  @IsNumber() @Min(0) @IsOptional() requestedAmount?: number;
  @IsNumber() @Min(0) @IsOptional() requestedQuota?: number;
  @IsString() @IsOptional() serviceId?: string;
  @IsString() @IsNotEmpty() idempotencyKey!: string;
  @IsString() @IsOptional() reason?: string;
}

export class SettleRefundDto {
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsString() channel?: 'VNPAY_PROVIDER' | 'BANK_TRANSFER_PROOF' | 'CASH_RECEIPT';
  @IsOptional() @IsString() payoutReceiptRef?: string;
  @IsOptional() @IsString() reason?: string;
}

