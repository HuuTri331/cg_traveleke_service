import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmergencyUnavailableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  hotelId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  staffUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  startAt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  endAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
