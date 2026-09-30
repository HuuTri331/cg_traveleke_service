import { Type } from 'class-transformer';

import {
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsString()
  roomId!: string;

  @IsString()
  userId!: string;

  @IsDateString()
  checkInAt!: string;

  @IsDateString()
  checkOutAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalGuests!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomCount!: number;

  @IsString()
  @MaxLength(150)
  contactName!: string;

  @IsEmail()
  contactEmail!: string;

  @IsString()
  @MaxLength(20)
  contactPhone!: string;

  @IsOptional()
  @IsString()
  specialRequest?: string;

  /**
   * Idempotency Key gửi từ Client để chống Duplicate Booking khi mạng chập chờn hoặc retry
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

