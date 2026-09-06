import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/login
   * Đăng nhập và nhận JWT token.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const token = await this.authService.login(dto);
    return {
      success: true,
      message: 'Đăng nhập thành công.',
      data: token,
    };
  }

  /**
   * GET /api/auth/me
   * Lấy thông tin user đang đăng nhập kèm danh sách permissions.
   * Yêu cầu: Đã đăng nhập (JWT token hợp lệ).
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: User) {
    const me = this.authService.getMe(user);
    return {
      success: true,
      data: me,
    };
  }

  /**
   * POST /api/auth/logout
   * Phía client tự xoá token. Backend chỉ xác nhận đăng xuất thành công.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout() {
    return {
      success: true,
      message: 'Đăng xuất thành công.',
    };
  }
}
