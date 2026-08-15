import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { RoomStatus } from '../entities/room.entity';

export class QueryRoomDto {
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
  @Type(() => Number)
  @IsInt({ message: 'hotelId lọc phải là số nguyên' })
  @Min(1, { message: 'hotelId lọc phải lớn hơn hoặc bằng 1' })
  hotelId?: number;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm (search) phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsEnum(RoomStatus, {
    message:
      'Trạng thái lọc (status) không hợp lệ (chỉ chấp nhận: AVAILABLE, UNAVAILABLE, MAINTENANCE)',
  })
  status?: RoomStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Giá tối thiểu (minPrice) phải là số hợp lệ' })
  @Min(0, { message: 'Giá tối thiểu không được nhỏ hơn 0' })
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Giá tối đa (maxPrice) phải là số hợp lệ' })
  @Min(0, { message: 'Giá tối đa không được nhỏ hơn 0' })
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số người lớn (adults) phải là số nguyên' })
  @Min(1, { message: 'Số người lớn tối thiểu là 1' })
  adults?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trẻ em (children) phải là số nguyên' })
  @Min(0, { message: 'Số trẻ em không được nhỏ hơn 0' })
  children?: number;
}
