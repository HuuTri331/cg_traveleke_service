import { IsEnum, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class AssignStaffDto {
  @IsNotEmpty({ message: 'ID khách sạn không được để trống.' })
  @IsNumberString({}, { message: 'ID khách sạn phải là số.' })
  hotelId!: string;

  @IsNotEmpty({ message: 'ID nhân viên không được để trống.' })
  @IsNumberString({}, { message: 'ID nhân viên phải là số.' })
  staffUserId!: string;

  @IsOptional()
  @IsEnum(['MANAGER', 'EMPLOYEE'], {
    message: 'Vai trò phải là MANAGER hoặc EMPLOYEE.',
  })
  staffRole?: string;
}
