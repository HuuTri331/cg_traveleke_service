import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  /**
   * Refresh Token truyền qua body (cho Mobile hoặc non-cookie clients).
   * Nếu không có trong body, AuthController sẽ tìm trong HttpOnly Cookie 'traveleke_refresh_token'.
   */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
