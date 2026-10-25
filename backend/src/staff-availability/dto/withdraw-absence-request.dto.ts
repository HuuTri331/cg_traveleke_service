import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class WithdrawAbsenceRequestDto {
  @IsOptional()
  @IsString({ message: 'Lý do rút đơn phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Lý do rút đơn không được vượt quá 500 ký tự' })
  reason?: string;

  @IsOptional()
  @IsInt({ message: 'expectedVersion phải là số nguyên' })
  @Min(1)
  expectedVersion?: number;
}
