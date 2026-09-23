import { IsNotEmpty, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { TrackingEventType } from '../entities/hotel-tracking.entity';

export class TrackEventDto {
  @IsNotEmpty({ message: 'hotelId không được để trống' })
  @Type(() => Number)
  @IsNumber({}, { message: 'hotelId phải là số' })
  hotelId!: number;

  @IsOptional()
  @IsEnum(TrackingEventType)
  eventType?: TrackingEventType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMax?: number;
}
