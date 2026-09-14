import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Địa chỉ email không hợp lệ.' })
  @IsNotEmpty({ message: 'Email không được để trống.' })
  email!: string;
}
