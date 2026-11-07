import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class QuoteBookingAmendmentBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  newCheckInAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  newCheckOutAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  newRoomTypeId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  newQuantity?: number;
}

export class RequestBookingAmendmentBodyDto extends QuoteBookingAmendmentBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandKey!: string;
}

export class StayTimeRequestBodyDto {
  @IsIn(['EARLY_CHECKIN', 'LATE_CHECKOUT', 'EXTRA_NIGHT'])
  requestType!: 'EARLY_CHECKIN' | 'LATE_CHECKOUT' | 'EXTRA_NIGHT';

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  requestedTime!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  feeVnd?: number;

  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;
}
