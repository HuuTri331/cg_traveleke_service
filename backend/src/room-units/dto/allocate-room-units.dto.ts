import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AllocateRoomUnitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  unitIds!: string[];

  @IsString()
  commandId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedBookingVersion?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
