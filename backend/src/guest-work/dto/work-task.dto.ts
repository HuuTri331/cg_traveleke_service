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
  decision!: 'VERIFIED' | 'REJECTED' | 'FAILED';

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  evidenceRef?: string;
}

export class CreateOfflineWorkLogDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsEnum(WorkTaskType)
  @IsOptional()
  type?: WorkTaskType;

  @IsString()
  @IsNotEmpty()
  channel!: 'PHONE' | 'FRONT_DESK' | 'OFFLINE_OTHER';

  @IsString()
  @IsNotEmpty()
  claimedOccurredAt!: string;

  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsString()
  @IsOptional()
  evidenceRef?: string;

  @IsString()
  @IsOptional()
  taskId?: string;
}

