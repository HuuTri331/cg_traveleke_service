import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const response = context.switchToHttp().getResponse();

      let message =
        'Bạn cần đăng nhập bằng Bearer token hợp lệ để thực hiện thao tác này.';
      let wwwAuthenticate = 'Bearer';

      if (info?.name === 'TokenExpiredError') {
        message = 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.';
        wwwAuthenticate =
          'Bearer error="invalid_token", error_description="The access token expired"';
      } else if (info?.name === 'JsonWebTokenError') {
        message = 'Mã xác thực Bearer token không hợp lệ hoặc đã bị thay đổi.';
        wwwAuthenticate =
          'Bearer error="invalid_token", error_description="Invalid token signature"';
      }

      if (response && typeof response.setHeader === 'function') {
        response.setHeader('WWW-Authenticate', wwwAuthenticate);
      }

      throw (
        err ||
        new UnauthorizedException(message)
      );
    }
    return user as TUser;
  }
}
