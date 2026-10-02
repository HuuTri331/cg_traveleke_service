import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReassignStaffDto {
  @IsNotEmpty({ message: 'Vui lòng chọn nhân viên được phân công.' })
  @IsString()
  staffUserId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
