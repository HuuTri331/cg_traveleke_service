import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString()
  @Length(2, 150, { message: 'Họ tên phải từ 2 đến 150 ký tự' })
  fullName!: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password?: string;

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
  @IsEnum(['EMPLOYEE', 'ADMIN'], { message: 'Role phải là EMPLOYEE hoặc ADMIN' })
  role?: 'EMPLOYEE' | 'ADMIN';
}