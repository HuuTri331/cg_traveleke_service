import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateStatusDto {
  @IsNotEmpty({ message: 'Status không được để trống' })
  @IsEnum(['ACTIVE', 'BLOCKED'], {
    message: 'Status phải là ACTIVE hoặc BLOCKED',
  })
  status!: 'ACTIVE' | 'BLOCKED';
}
