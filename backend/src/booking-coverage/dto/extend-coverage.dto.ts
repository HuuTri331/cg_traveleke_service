import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class ExtendCoverageDto {
  @IsString()
  @IsNotEmpty()
  newEndAt!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsNumber()
  expectedVersion!: number;
}

