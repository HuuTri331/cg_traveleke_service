import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(CoverageTaskType, { each: true })
  allowedTaskTypes?: CoverageTaskType[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsNumber()
  @IsOptional()
  expectedAssignmentVersion?: number;

  @IsString()
  @IsOptional()
  commandId?: string;

  @IsOptional()
  @IsEnum({ TASK_IDS: 'TASK_IDS', TASK_TYPES: 'TASK_TYPES', BOOKING_TASKS: 'BOOKING_TASKS' })
  scopeMode?: 'TASK_IDS' | 'TASK_TYPES' | 'BOOKING_TASKS';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskIds?: string[];

  @IsOptional() @IsString()
  absenceRequestId?: string;

  @IsOptional() @IsString()
  completionDeadline?: string;

  @IsOptional()
  @IsBoolean()
  requireDelegateAcceptance?: boolean;
}


