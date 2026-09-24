import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { ServiceType } from '../entities/room-service.entity';
import { RecoveryType } from '../entities/service-recovery-log.entity';
import { ServiceRequestStatus } from '../entities/service-request.entity';

// ============================================================
// SERVICE CATEGORIES
// ============================================================

export class CreateServiceCategoryDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateServiceCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

// ============================================================
// ROOM SERVICES
// ============================================================

export class CreateRoomServiceDto {
  @IsInt()
  categoryId: number;

  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsOptional()
  @IsInt()
  roomTypeId?: number;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;

  // Phân loại dịch vụ theo nghiệp vụ
  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  // Quota
  @IsOptional()
  @IsInt()
  @Min(1)
  quotaPerBooking?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quotaPerNight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number;

  // Vận hành
  @IsOptional()
  @IsInt()
  @Min(0)
  slaMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacityPerHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeHours?: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  departmentOwner?: string;
}

export class UpdateRoomServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsBoolean()
  isComplimentary?: boolean;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  @IsOptional()
  @IsInt()
  @Min(1)
  quotaPerBooking?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quotaPerNight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacityPerHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeHours?: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  departmentOwner?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

// ============================================================
// SERVICE REQUESTS
// ============================================================

export class CreateServiceRequestDto {
  @IsInt()
  bookingId: number;

  @IsInt()
  serviceId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  scheduledAt?: string;
}

export class UpdateServiceRequestDto {
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;

  @IsOptional()
  @IsInt()
  assignedTo?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  completedAt?: string;

  @IsOptional()
  confirmedAt?: string;

  @IsOptional()
  @IsString()
  failureReason?: string;

  @IsOptional()
  @IsString()
  recoveryAction?: string;

  @IsOptional()
  @IsInt()
  recoveryApprovedBy?: number;

  @IsOptional()
  @Min(0)
  recoveryCost?: number;
}

// ============================================================
// BOOKING SERVICE SNAPSHOT
// ============================================================

export class CreateBookingSnapshotDto {
  @IsInt()
  bookingId: number;

  @IsInt()
  serviceId: number;

  @IsString()
  serviceName: string;

  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsString()
  unit: string;

  @Min(0)
  basePrice: number;

  @IsBoolean()
  isComplimentary: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaIncluded?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaPerNight?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

// ============================================================
// SERVICE RECOVERY LOG
// ============================================================

export class CreateServiceRecoveryLogDto {
  @IsOptional()
  @IsInt()
  serviceRequestId?: number;

  @IsInt()
  bookingId: number;

  @IsInt()
  reportedBy: number;

  @IsEnum(RecoveryType)
  recoveryType: RecoveryType;

  @IsString()
  reason: string;

  @IsString()
  actionTaken: string;

  @IsOptional()
  @Min(0)
  costIncurred?: number;
}

export class ApproveRecoveryDto {
  @IsInt()
  approvedBy: number;

  @IsEnum(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';
}
