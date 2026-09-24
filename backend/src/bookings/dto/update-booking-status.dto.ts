import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum BookingStatusAction {
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class UpdateBookingStatusDto {
  @IsNotEmpty({ message: 'Trạng thái mới không được để trống.' })
  @IsEnum(BookingStatusAction, {
    message:
      'Trạng thái không hợp lệ. Chấp nhận: CONFIRMED, REJECTED, CHECKED_IN, COMPLETED, CANCELLED.',
  })
  status!: BookingStatusAction;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú không được vượt quá 500 ký tự.' })
  note?: string;
}
