import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCancellationRequestDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
