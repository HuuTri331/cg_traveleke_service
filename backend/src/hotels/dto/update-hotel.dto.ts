import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HotelStatus } from '../entities/hotel.entity';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class UpdateHotelDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Loại khách sạn (hotelTypeId) phải là số nguyên dương' })
  @Min(1, { message: 'Loại khách sạn (hotelTypeId) phải lớn hơn hoặc bằng 1' })
  hotelTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Địa điểm (locationId) phải là số nguyên dương' })
  @Min(1, { message: 'Địa điểm (locationId) phải lớn hơn hoặc bằng 1' })
  locationId?: number;

  @IsOptional()
  @IsString({ message: 'Tên khách sạn phải là chuỗi ký tự' })
  @MaxLength(200, { message: 'Tên khách sạn không được vượt quá 200 ký tự' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Slug phải là chuỗi ký tự' })
  @MaxLength(220, { message: 'Slug không được vượt quá 220 ký tự' })
  slug?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả khách sạn phải là chuỗi ký tự' })
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Xếp hạng sao phải là số nguyên từ 1 đến 5' })
  @Min(1, { message: 'Xếp hạng sao tối thiểu là 1 sao' })
  @Max(5, { message: 'Xếp hạng sao tối đa là 5 sao' })
  starRating?: number | null;

  @IsOptional()
  @IsString({ message: 'Địa chỉ khách sạn phải là chuỗi ký tự' })
  @MaxLength(255, {
    message: 'Địa chỉ khách sạn không được vượt quá 255 ký tự',
  })
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 7 },
    {
      message: 'Vĩ độ (latitude) phải là số thực với tối đa 7 chữ số thập phân',
    },
  )
  @Min(-90, { message: 'Vĩ độ (latitude) phải từ -90 đến 90 độ' })
  @Max(90, { message: 'Vĩ độ (latitude) phải từ -90 đến 90 độ' })
  latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 7 },
    {
      message:
        'Kinh độ (longitude) phải là số thực với tối đa 7 chữ số thập phân',
    },
  )
  @Min(-180, { message: 'Kinh độ (longitude) phải từ -180 đến 180 độ' })
  @Max(180, { message: 'Kinh độ (longitude) phải từ -180 đến 180 độ' })
  longitude?: number | null;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  phone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Email liên hệ không đúng định dạng' })
  @MaxLength(255, { message: 'Email không được vượt quá 255 ký tự' })
  email?: string | null;

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
  @IsString({ message: 'Đường dẫn ảnh bìa phải là chuỗi ký tự' })
  @MaxLength(500, {
    message: 'Đường dẫn ảnh bìa không được vượt quá 500 ký tự',
  })
  coverImageUrl?: string | null;

  @IsOptional()
  @IsEnum(HotelStatus, {
    message:
      'Trạng thái khách sạn không hợp lệ (chỉ chấp nhận: DRAFT, ACTIVE, INACTIVE)',
  })
  status?: HotelStatus;
}
