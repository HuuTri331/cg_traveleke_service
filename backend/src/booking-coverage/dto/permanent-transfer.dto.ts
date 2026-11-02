import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TaskHandoverDecisionDto {
  @IsString() @IsNotEmpty() taskId!: string;
  @IsIn(['HANDOVER', 'CONTINUE']) action!: 'HANDOVER' | 'CONTINUE';
  @IsOptional() @IsString() leaseUntil?: string;
  @IsString() @IsNotEmpty() reason!: string;
}

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

  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => TaskHandoverDecisionDto)
  taskDecisions?: TaskHandoverDecisionDto[];
}

