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
import { RoomIncidentResolutionType } from '../entities/room-incident.entity';

export class OpenRoomIncidentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  bookingId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  roomTypeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  affectedUnitId?: string | null;

  @IsOptional()
  @IsIn(['ROOM_NOT_READY', 'ROOM_AT_RISK', 'OVERBOOKED_UNIT'])
  incidentType?: 'ROOM_NOT_READY' | 'ROOM_AT_RISK' | 'OVERBOOKED_UNIT';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceKey?: string;
}

export class ProposeIncidentOptionDto {
  @IsEnum(RoomIncidentResolutionType)
  resolutionType!: RoomIncidentResolutionType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  proposedUnitId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  proposedRoomTypeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compensationVnd?: number;

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
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commandId?: string;
}

export class ResolveRoomIncidentDto {
  @IsBoolean()
  customerAccepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commandId?: string;
}
