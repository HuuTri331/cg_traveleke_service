import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export enum FrontDeskBookingSource {
  WALK_IN = 'WALK_IN',
  PHONE = 'PHONE',
}

export class CreateFrontDeskBookingDto {
  @IsNotEmpty({ message: 'Vui lòng chọn phòng (roomId).' })
  @IsString()
  roomId!: string;

  @IsNotEmpty({ message: 'Nguồn đặt phòng là bắt buộc (WALK_IN hoặc PHONE).' })
  @IsEnum(FrontDeskBookingSource, {
    message: 'Nguồn đặt phòng phải là WALK_IN hoặc PHONE.',
  })
  bookingSource!: FrontDeskBookingSource;

  @IsNotEmpty({ message: 'Thời gian nhận phòng là bắt buộc.' })
  @IsString()
  checkInAt!: string;

  @IsNotEmpty({ message: 'Thời gian trả phòng là bắt buộc.' })
  @IsString()
  checkOutAt!: string;

  @IsInt({ message: 'Số khách phải là số nguyên.' })
  @Min(1, { message: 'Số khách tối thiểu là 1.' })
  totalGuests!: number;

  @IsInt({ message: 'Số phòng phải là số nguyên.' })
  @Min(1, { message: 'Số phòng tối thiểu là 1.' })
  roomCount!: number;

  @IsNotEmpty({ message: 'Tên khách hàng là bắt buộc.' })
  @IsString()
  @MaxLength(150)
  contactName!: string;

  @IsNotEmpty({ message: 'Email khách hàng là bắt buộc.' })
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(255)
  contactEmail!: string;

  @IsNotEmpty({ message: 'Số điện thoại khách hàng là bắt buộc.' })
  @IsString()
  @MaxLength(20)
  contactPhone!: string;

  @IsOptional()
  @IsString()
  specialRequest?: string;

  @IsOptional()
  @IsString()
  callReference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
