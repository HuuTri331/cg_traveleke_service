import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateGuestMessageDto {
  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsString()
  @IsOptional()
  clientMsgId?: string;

  @IsString()
  @IsOptional()
  taskId?: string;
}

