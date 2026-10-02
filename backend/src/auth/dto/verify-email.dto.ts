import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'Token xác thực phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Token xác thực không được để trống.' })
  token!: string;
}
