import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(2, 150, { message: 'Họ tên phải từ 2 đến 150 ký tự' })
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(10, 20, { message: 'Số điện thoại phải từ 10 đến 20 ký tự' })
  phone?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh không hợp lệ (định dạng YYYY-MM-DD)' })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(['MALE', 'FEMALE', 'OTHER'], { message: 'Giới tính phải là MALE, FEMALE hoặc OTHER' })
  gender?: 'MALE' | 'FEMALE' | 'OTHER';

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password?: string;
}
