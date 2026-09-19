import { IsOptional, IsString, IsNumberString, IsEnum } from 'class-validator';
import { BookingStatus } from '../entities/booking.entity';

export class QueryBookingDto {
  @IsOptional()
  @IsNumberString({}, { message: 'Trang phải là số.' })
  page?: number;

  @IsOptional()
  @IsNumberString({}, { message: 'Số lượng mỗi trang phải là số.' })
  perPage?: number;

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
