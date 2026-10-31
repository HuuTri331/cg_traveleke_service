import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { WorkTaskType, WorkTaskPriority } from '../entities/guest-work-task.entity';

export class CreateWorkTaskDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsEnum(WorkTaskType)
  type!: WorkTaskType;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(WorkTaskPriority)
  @IsOptional()
  priority?: WorkTaskPriority;

  @IsString()
  @IsOptional()
  assignedStaffId?: string;
}

export class ClaimTaskDto {
  @IsString()
  @IsOptional()
  commandId?: string;
}

export class CompleteTaskDto {
  @IsString()
  @IsOptional()
  evidenceRef?: string;

  @IsString()
  @IsOptional()
  commandId?: string;
}

export class VerifyTaskDto {
  @IsString()
  @IsNotEmpty()
  decision!: 'VERIFIED' | 'REJECTED';

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  evidenceRef?: string;
}

