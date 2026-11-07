import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SubmitPrecheckinByTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  arrivalTransport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bedPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialRequests?: string;

  @IsOptional()
  @IsObject()
  guestDataMinimal?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commandId?: string;
}

export class ReviewPrecheckinDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class OccupantItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @IsOptional()
  @IsIn(['BOOKER', 'PAYER', 'LEAD_GUEST', 'OCCUPANT'])
  contactRole?: 'BOOKER' | 'PAYER' | 'LEAD_GUEST' | 'OCCUPANT';

  @IsOptional()
  @IsBoolean()
  isAdult?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(17)
  childAge?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  leadGuest?: boolean;
}

export class UpsertOccupantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OccupantItemDto)
  occupants!: OccupantItemDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
