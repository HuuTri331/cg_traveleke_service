import { IsEmail, IsNotEmpty } from 'class-validator';

export class ValidateEmailDto {
  @IsEmail({}, { message: 'Địa chỉ email không đúng định dạng.' })
  @IsNotEmpty({ message: 'Email không được để trống.' })
  email!: string;
}
