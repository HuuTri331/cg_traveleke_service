import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { WorkTaskPriority, WorkTaskType } from '../entities/guest-work-task.entity';

export class CreateWorkTaskDto {
  @IsString() @IsOptional() hotelId?: string;
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsEnum(WorkTaskType) type!: WorkTaskType;
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(WorkTaskPriority) @IsOptional() priority?: WorkTaskPriority;
  @IsString() @IsOptional() assignedStaffId?: string;
}
export class ClaimTaskDto {
  @IsString() @IsOptional() commandId?: string;
  @IsNumber() @IsOptional() expectedVersion?: number;
}
export class CompleteTaskDto extends ClaimTaskDto {
  @IsString() @IsOptional() evidenceRef?: string;
  @IsString() @IsOptional() evidenceType?: string;
  @IsString() @IsOptional() note?: string;
}
export class VerifyTaskDto extends ClaimTaskDto {
  @IsString() @IsNotEmpty() decision!: 'VERIFIED' | 'REJECTED' | 'FAILED';
  @IsString() @IsOptional() note?: string;
  @IsString() @IsOptional() evidenceRef?: string;
}
export class CreateOfflineWorkLogDto {
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsEnum(WorkTaskType) @IsOptional() type?: WorkTaskType;
  @IsString() @IsNotEmpty() channel!: 'PHONE' | 'FRONT_DESK' | 'OFFLINE_OTHER';
  @IsString() @IsNotEmpty() claimedOccurredAt!: string;
  @IsString() @IsNotEmpty() summary!: string;
  @IsString() @IsOptional() evidenceRef?: string;
  @IsString() @IsOptional() taskId?: string;
}
