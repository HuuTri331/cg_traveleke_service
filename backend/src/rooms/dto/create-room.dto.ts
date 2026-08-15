import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { RoomStatus } from '../entities/room.entity';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateRoomDto {
  @IsNotEmpty({ message: 'Khách sạn (hotelId) không được để trống' })
  @Type(() => Number)
  @IsInt({ message: 'Khách sạn (hotelId) phải là số nguyên dương' })
  @Min(1, { message: 'Khách sạn (hotelId) phải lớn hơn hoặc bằng 1' })
  hotelId!: number;

  @IsNotEmpty({ message: 'Tên phòng không được để trống' })
  @IsString({ message: 'Tên phòng phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'Tên phòng không được vượt quá 150 ký tự' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Slug phải là chuỗi ký tự' })
  @MaxLength(180, { message: 'Slug không được vượt quá 180 ký tự' })
  slug?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phòng phải là chuỗi ký tự' })
  description?: string | null;

  @IsNotEmpty({
    message: 'Giá phòng mỗi đêm (pricePerNight) không được để trống',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Giá phòng mỗi đêm (pricePerNight) phải là số hợp lệ' },
  )
  @Min(0, { message: 'Giá phòng mỗi đêm không được nhỏ hơn 0' })
  pricePerNight!: number;

  @IsOptional()
  @Matches(TIME_PATTERN, {
    message:
      'Giờ nhận phòng (checkInTime) phải có định dạng HH:mm hoặc HH:mm:ss (ví dụ: 14:00:00)',
  })
  checkInTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, {
    message:
      'Giờ trả phòng (checkOutTime) phải có định dạng HH:mm hoặc HH:mm:ss (ví dụ: 12:00:00)',
  })
  checkOutTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng người lớn tối đa (maxAdults) phải là số nguyên' })
  @Min(1, { message: 'Số lượng người lớn tối đa phải từ 1 người trở lên' })
  maxAdults?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng trẻ em tối đa (maxChildren) phải là số nguyên' })
  @Min(0, { message: 'Số lượng trẻ em tối đa không được nhỏ hơn 0' })
  maxChildren?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Tổng số phòng loại này (totalRooms) phải là số nguyên' })
  @Min(1, { message: 'Tổng số phòng loại này phải từ 1 phòng trở lên' })
  totalRooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số phòng còn trống (availableRooms) phải là số nguyên' })
  @Min(0, { message: 'Số phòng còn trống không được nhỏ hơn 0' })
  availableRooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng giường (bedCount) phải là số nguyên' })
  @Min(1, { message: 'Số lượng giường tối thiểu là 1 giường' })
  @Max(2, {
    message: 'Số lượng giường tối đa là 2 giường (không được quá 2 giường)',
  })
  bedCount?: number;

  @IsOptional()
  @IsString({ message: 'Loại giường (bedType) phải là chuỗi ký tự' })
  @MaxLength(100, { message: 'Loại giường không được vượt quá 100 ký tự' })
  bedType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Diện tích phòng (roomSize) phải là số nguyên (m²)' })
  @Min(1, { message: 'Diện tích phòng phải lớn hơn 0 m²' })
  roomSize?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Điểm đánh giá (rating) phải là số từ 1 đến 5' },
  )
  @Min(1, { message: 'Điểm đánh giá tối thiểu là 1.00' })
  @Max(5, { message: 'Điểm đánh giá tối đa là 5.00' })
  rating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượt đánh giá (reviewCount) phải là số nguyên' })
  @Min(0, { message: 'Số lượt đánh giá không được nhỏ hơn 0' })
  reviewCount?: number;

  @IsOptional()
  @IsString({ message: 'Đường dẫn ảnh phòng phải là chuỗi ký tự' })
  @MaxLength(500, {
    message: 'Đường dẫn ảnh phòng không được vượt quá 500 ký tự',
  })
  coverImageUrl?: string | null;

  @IsOptional()
  @IsEnum(RoomStatus, {
    message:
      'Trạng thái phòng không hợp lệ (chỉ chấp nhận: AVAILABLE, UNAVAILABLE, MAINTENANCE)',
  })
  status?: RoomStatus;
}
