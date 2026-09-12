import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Đánh dấu route chỉ cho phép các role được chỉ định truy cập.
 * @example @Roles('ADMIN')
 * @example @Roles('ADMIN', 'EMPLOYEE')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);