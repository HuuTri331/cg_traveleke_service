import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateHotelBusinessSettingRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ianaTimezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/)
  cutoffTime?: string;

  @IsOptional()
  @IsBoolean()
  requireRoomInspection?: boolean;

  @IsOptional()
  @IsBoolean()
  allowGuestRoomNumberReveal?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  freeEarlyCheckinMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  freeLateCheckoutMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ToggleFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  flagKey!: string;

  @IsBoolean()
  enabled!: boolean;
}
