import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ConfirmDepartureDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  commandId?: string;

  @IsOptional()
  @IsBoolean()
  acknowledgeServiceReceivables?: boolean;

  @IsOptional()
  @IsString()
  servicePaymentReceiptRef?: string;
}
