import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApprovalRequestType, ApprovalStatus } from '../entities/approval-request.entity';

export class CreateApprovalRequestDto {
  @IsNotEmpty({ message: 'Khách sạn (hotelId) là bắt buộc.' })
  @IsString()
  hotelId!: string;

  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsNotEmpty({ message: 'Loại yêu cầu phê duyệt là bắt buộc.' })
  @IsEnum(ApprovalRequestType, {
    message: 'Loại yêu cầu không hợp lệ (REFUND, RATE_OVERRIDE, DISCOUNT, COMPLIMENTARY, SERVICE_RECOVERY).',
  })
  requestType!: ApprovalRequestType;

  @IsNumber()
  @Min(0, { message: 'Số tiền phải lớn hơn hoặc bằng 0.' })
  amount!: number;

  @IsNotEmpty({ message: 'Lý do yêu cầu phê duyệt là bắt buộc.' })
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  evidenceUrl?: string;
}

export class DecideApprovalRequestDto {
  @IsNotEmpty({ message: 'Quyết định là bắt buộc (APPROVED hoặc REJECTED).' })
  @IsEnum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED], {
    message: 'Quyết định phải là APPROVED hoặc REJECTED.',
  })
  decision!: ApprovalStatus.APPROVED | ApprovalStatus.REJECTED;

  @IsNotEmpty({ message: 'Ghi chú / lý do phê duyệt hoặc từ chối là bắt buộc.' })
  @IsString()
  reviewNote!: string;
}
