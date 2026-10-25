import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { AbsenceRequestType } from '../entities/staff-absence-request.entity';

export class CreateAbsenceRequestDto {
  @IsNotEmpty({ message: 'Khách sạn (hotelId) không được để trống' })
  @IsString({ message: 'hotelId phải là chuỗi ký tự ID' })
  hotelId!: string;

  @IsNotEmpty({ message: 'Loại yêu cầu (requestType) không được để trống' })
  @IsEnum(AbsenceRequestType, {
    message: 'requestType phải là LEAVE, LATE_ARRIVAL, EARLY_LEAVE hoặc SHORT_ABSENCE',
  })
  requestType!: AbsenceRequestType;

  @IsNotEmpty({ message: 'Thời điểm bắt đầu (startAt) không được để trống' })
  @IsDateString({}, { message: 'startAt phải có định dạng ngày giờ hợp lệ (ISO8601)' })
  startAt!: string;

  @IsNotEmpty({ message: 'Thời điểm kết thúc (endAt) không được để trống' })
  @IsDateString({}, { message: 'endAt phải có định dạng ngày giờ hợp lệ (ISO8601)' })
  endAt!: string;

  @IsOptional()
  @IsDateString({}, { message: 'expectedArrivalAt phải có định dạng ngày giờ hợp lệ (ISO8601)' })
  expectedArrivalAt?: string;

  @IsNotEmpty({ message: 'Lý do vắng mặt không được để trống' })
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  @MaxLength(1000, { message: 'Lý do không được vượt quá 1000 ký tự' })
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  evidenceRef?: string;
}
