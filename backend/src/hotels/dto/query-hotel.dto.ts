import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { HotelStatus } from '../entities/hotel.entity';

export class QueryHotelDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang (page) phải là số nguyên' })
  @Min(1, { message: 'Số trang (page) tối thiểu là 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng mỗi trang (perPage) phải là số nguyên' })
  @Min(1, { message: 'Số lượng mỗi trang (perPage) tối thiểu là 1' })
  @Max(100, { message: 'Số lượng mỗi trang (perPage) tối đa là 100' })
  perPage?: number = 20;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm (search) phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsEnum(HotelStatus, {
    message:
      'Trạng thái lọc (status) không hợp lệ (chỉ chấp nhận: DRAFT, ACTIVE, INACTIVE)',
  })
  status?: HotelStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hotelTypeId lọc phải là số nguyên' })
  @Min(1, { message: 'hotelTypeId lọc phải lớn hơn hoặc bằng 1' })
  hotelTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'locationId lọc phải là số nguyên' })
  @Min(1, { message: 'locationId lọc phải lớn hơn hoặc bằng 1' })
  locationId?: number;
}
