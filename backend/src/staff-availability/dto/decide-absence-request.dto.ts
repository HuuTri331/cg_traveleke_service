import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class DecideAbsenceRequestDto {
  @IsNotEmpty({ message: 'Quyết định (decision) không được để trống' })
  @IsIn(['APPROVE', 'REJECT'], {
    message: 'decision phải là APPROVE hoặc REJECT',
  })
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString({ message: 'Ghi chú duyệt phải là chuỗi ký tự' })
  @MaxLength(1000, { message: 'Ghi chú duyệt không được vượt quá 1000 ký tự' })
  reviewNote?: string;

  @IsOptional()
  @IsInt({ message: 'expectedVersion phải là số nguyên' })
  @Min(1)
  expectedVersion?: number;
}
