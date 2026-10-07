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

export class CheckoutSessionDto {
  @IsString()
  roomId!: string;

  @IsOptional()
  @IsString()
  hotelId?: string;

  @IsDateString()
  checkInAt!: string;

  @IsDateString()
  checkOutAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalGuests!: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}
