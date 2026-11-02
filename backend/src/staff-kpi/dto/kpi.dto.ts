import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { ReviewStage } from '../entities/guest-staff-review.entity';

export class SubmitStaffReviewDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsString()
  @IsNotEmpty()
  staffUserId!: string;

  @IsEnum(ReviewStage)
  stage!: ReviewStage;

  @IsNumber()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsOptional()
  commandId?: string;
}

export class UpdateStaffReviewDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class RequestKpiAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  staffUserId!: string;

  @IsString()
  @IsNotEmpty()
  periodKey!: string;

  @IsString()
  @IsNotEmpty()
  metricCode!: string;

  @IsNumber()
  delta!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsOptional()
  evidenceRef?: string;
}

export class DecideKpiAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  decision!: 'APPROVE' | 'REJECT';

  @IsString()
  @IsOptional()
  reviewNote?: string;
}

export class RecalculateKpiDto {
  @IsString()
  @IsOptional()
  periodKey?: string;

  @IsString()
  @IsOptional()
  staffUserId?: string;
}

