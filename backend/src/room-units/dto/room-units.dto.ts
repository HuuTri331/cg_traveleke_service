import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  RoomUnitHousekeepingState,
  RoomUnitOperationalStatus,
} from '../entities/room-unit.entity';

export class CreateRoomUnitBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  roomTypeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  roomNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bedConfig?: string;

  @IsOptional()
  @IsBoolean()
  isAccessible?: boolean;

  @IsOptional()
  @IsBoolean()
  isSmoking?: boolean;

  @IsOptional()
  @IsEnum(RoomUnitOperationalStatus)
  operationalStatus?: RoomUnitOperationalStatus;

  @IsOptional()
  @IsEnum(RoomUnitHousekeepingState)
  housekeepingState?: RoomUnitHousekeepingState;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateRoomUnitStateDto {
  @IsOptional()
  @IsEnum(RoomUnitOperationalStatus)
  operationalStatus?: RoomUnitOperationalStatus;

  @IsOptional()
  @IsEnum(RoomUnitHousekeepingState)
  housekeepingState?: RoomUnitHousekeepingState;

  @IsOptional()
  @IsIn(['UNVERIFIED', 'VERIFIED'])
  verificationStatus?: 'UNVERIFIED' | 'VERIFIED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class VerifyRoomUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PreviewRoomMoveDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  fromUnitId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  toUnitId!: string;

  @IsOptional()
  @IsIn(['SAME_ROOM_TYPE', 'COMPLIMENTARY_UPGRADE', 'PAID_UPGRADE'])
  moveType?: 'SAME_ROOM_TYPE' | 'COMPLIMENTARY_UPGRADE' | 'PAID_UPGRADE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceDeltaVnd?: number;

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
}

export class CommitRoomMoveDto extends PreviewRoomMoveDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  commandId!: string;
}
