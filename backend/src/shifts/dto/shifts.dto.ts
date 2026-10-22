import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateShiftDto {
  @IsNotEmpty({ message: 'Khách sạn (hotelId) là bắt buộc.' })
  @IsString()
  hotelId!: string;

  @IsNotEmpty({ message: 'Nhân viên (staffUserId) là bắt buộc.' })
  @IsString()
  staffUserId!: string;

  @IsNotEmpty({ message: 'Tên ca là bắt buộc.' })
  @IsString()
  shiftName!: string;

  @IsNotEmpty({ message: 'Ngày trực (shiftDate) là bắt buộc (YYYY-MM-DD).' })
  @IsDateString()
  shiftDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  openingCashFloat?: number;
}

export class StartShiftDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingCashFloat?: number;
}

export class EndShiftDto {
  @IsNotEmpty({ message: 'Số tiền mặt kiểm đếm cuối ca là bắt buộc.' })
  @IsNumber()
  @Min(0)
  closingCashCounted!: number;

  @IsOptional()
  @IsString()
  handoverNote?: string;
}

export class CreateHandoverDto {
  @IsNotEmpty({ message: 'Nhân viên ca sau (toStaffId) là bắt buộc.' })
  @IsString()
  toStaffId!: string;

  @IsOptional()
  @IsString()
  pendingTasks?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @IsOptional()
  @IsString()
  specialNotes?: string;
}
