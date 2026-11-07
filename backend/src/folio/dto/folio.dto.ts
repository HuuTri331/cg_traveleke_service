import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RecordFolioSettlementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  method!: string;

  @IsNumber()
  @Min(1)
  amountVnd!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  providerRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceUrl?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  approvalRequestId?: string;

  @IsOptional()
  @IsBoolean()
  verifiedByGateway?: boolean;
}

export class PostFolioAdjustmentDto {
  @IsIn(['CREDIT', 'DEBIT', 'REVERSAL'])
  direction!: 'CREDIT' | 'DEBIT' | 'REVERSAL';

  @IsNumber()
  @Min(1)
  amountVnd!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  approvedByManagerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  approvalRequestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reversesEntryId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;
}
