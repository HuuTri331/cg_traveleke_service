import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class AddRoomImageDto {
  @IsNotEmpty({ message: 'Đường dẫn ảnh (imageUrl) không được để trống' })
  @IsString({ message: 'Đường dẫn ảnh (imageUrl) phải là chuỗi ký tự' })
  @MaxLength(500, {
    message: 'Đường dẫn ảnh (imageUrl) không được vượt quá 500 ký tự',
  })
  imageUrl!: string;

  @IsOptional()
  @IsString({ message: 'Chú thích ảnh (caption) phải là chuỗi ký tự' })
  @MaxLength(200, {
    message: 'Chú thích ảnh (caption) không được vượt quá 200 ký tự',
  })
  caption?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Thứ tự hiển thị (sortOrder) phải là số nguyên' })
  @Min(0, { message: 'Thứ tự hiển thị (sortOrder) không được nhỏ hơn 0' })
  sortOrder?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({
    message: 'Đánh dấu ảnh chính (isPrimary) phải là boolean (true/false)',
  })
  isPrimary?: boolean;
}
