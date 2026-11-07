import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ApplyVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Z0-9_-]+$/i, {
    message: 'Mã voucher chỉ được chứa chữ cái, chữ số, gạch ngang hoặc gạch dưới.',
  })
  code!: string;
}
