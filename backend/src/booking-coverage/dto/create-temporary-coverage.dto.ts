import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsEnum,
  ArrayMinSize,
} from 'class-validator';
import { CoverageTaskType } from '../entities/booking-coverage-grant.entity';

export class CreateTemporaryCoverageDto {
  @IsString()
  @IsNotEmpty()
  delegateStaffUserId!: string;

  @IsString()
  @IsNotEmpty()
  startAt!: string;

  @IsString()
  @IsNotEmpty()
  endAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(CoverageTaskType, { each: true })
  allowedTaskTypes!: CoverageTaskType[];

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

