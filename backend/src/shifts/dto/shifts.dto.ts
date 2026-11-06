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
  @IsDateString()
  plannedStartAt?: string;

  @IsOptional()
  @IsDateString()
  plannedEndAt?: string;

  @IsOptional()
  @IsString()
  hotelTimezone?: string;

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

  @IsOptional()
  @IsString()
  commandId?: string;
}

export class EndShiftDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  closingCashCounted?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  closingCashActual?: number;

  @IsOptional()
  @IsString()
  handoverNote?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  commandId?: string;

  @IsOptional()
  forceEmergencyClose?: boolean;
}

export class CreateHandoverDto {
  @IsOptional()
  @IsString()
  toStaffId?: string;

  @IsOptional()
  @IsString()
  receiverStaffId?: string;

  @IsOptional()
  pendingTasks?: any;

  @IsOptional()
  pendingItems?: any;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @IsOptional()
  @IsString()
  specialNotes?: string;

  @IsOptional()
  @IsString()
  handoverNotes?: string;

  @IsOptional()
  acknowledgedFinancialAccountIds?: string[];
}
