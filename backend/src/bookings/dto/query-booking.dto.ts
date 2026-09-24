import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsNumberString,
  IsEnum,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { BookingStatus } from '../entities/booking.entity';

export class QueryBookingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang (page) phải là số nguyên.' })
  @Min(1, { message: 'Số trang (page) tối thiểu là 1.' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng mỗi trang (perPage) phải là số nguyên.' })
  @Min(1, { message: 'Số lượng mỗi trang (perPage) tối thiểu là 1.' })
  @Max(100, { message: 'Số lượng mỗi trang (perPage) tối đa là 100.' })
  perPage?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(BookingStatus, { message: 'Trạng thái filter không hợp lệ.' })
  status?: BookingStatus;

  @IsOptional()
  @IsNumberString()
  hotelId?: string;
}
