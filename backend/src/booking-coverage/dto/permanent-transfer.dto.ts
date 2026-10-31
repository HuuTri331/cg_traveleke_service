import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class PermanentTransferDto {
  @IsString()
  @IsNotEmpty()
  toStaffUserId!: string;

  @IsString()
  @IsNotEmpty()
  reasonCode!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsNumber()
  @IsOptional()
  expectedAssignmentVersion?: number;

  @IsString()
  @IsOptional()
  commandId?: string;
}

