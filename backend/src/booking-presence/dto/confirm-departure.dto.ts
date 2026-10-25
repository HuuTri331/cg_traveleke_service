import { IsOptional, IsString } from 'class-validator';

export class ConfirmDepartureDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  commandId?: string;
}
