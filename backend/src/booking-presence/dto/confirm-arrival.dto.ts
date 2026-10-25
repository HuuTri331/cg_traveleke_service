import { IsOptional, IsString, IsNumber } from 'class-validator';

export class ConfirmArrivalDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  commandId?: string;

  @IsOptional()
  @IsNumber()
  expectedPresenceVersion?: number;
}
