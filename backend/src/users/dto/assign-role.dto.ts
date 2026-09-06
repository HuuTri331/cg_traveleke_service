import { IsEnum, IsNotEmpty } from 'class-validator';

export class AssignRoleDto {
  @IsNotEmpty({ message: 'Role không được để trống' })
  @IsEnum(['ADMIN', 'EMPLOYEE', 'CUSTOMER'], {
    message: 'Role phải là ADMIN, EMPLOYEE hoặc CUSTOMER',
  })
  role!: 'ADMIN' | 'EMPLOYEE' | 'CUSTOMER';
}
