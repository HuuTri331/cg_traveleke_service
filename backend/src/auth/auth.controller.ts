import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';

const avatarMulterOptions = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      const dir = path.join(process.cwd(), 'uploads', 'avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req: any, file: any, cb: any) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new BadRequestException('Chỉ chấp nhận ảnh JPG, PNG, WEBP.'), false);
    }
    cb(null, true);
  },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /api/auth/register
   * Đăng ký tài khoản khách hàng mới (có thể upload avatar).
   * Gửi link xác thực tới Gmail và yêu cầu xác thực trước khi đăng nhập.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  async register(
    @Body() dto: RegisterDto,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    const avatarUrl = avatarFile ? `/uploads/avatars/${avatarFile.filename}` : undefined;
    const data = await this.authService.register(dto, avatarUrl);
    return {
      success: true,
      message:
        'Đăng ký tài khoản thành công! Chúng tôi đã gửi email xác thực tới địa chỉ Gmail của bạn. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản.',
      data,
    };
  }

  /**
   * POST /api/auth/verify-email
   * API xác thực email từ token (dành cho frontend SPA gọi)
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    const result = await this.authService.verifyEmail(dto.token);
    return result;
  }

  /**
   * GET /api/auth/verify-email?token=xxx
   * Endpoint mở trực tiếp từ email (tự động chuyển hướng về trang frontend)
   */
  @Get('verify-email')
  async verifyEmailRedirect(@Query('token') token: string, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    try {
      await this.authService.verifyEmail(token);
      return res.redirect(`${frontendUrl}/verify-email?verified=true&token=${encodeURIComponent(token)}`);
    } catch (err: any) {
      const errorMsg = encodeURIComponent(err?.message || 'Xác thực không hợp lệ');
      return res.redirect(`${frontendUrl}/verify-email?error=${errorMsg}`);
    }
  }

  /**
   * POST /api/auth/resend-verification
   * Gửi lại liên kết xác thực tới Gmail của khách hàng
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    const result = await this.authService.resendVerification(dto.email);
    return result;
  }

  /**
   * POST /api/auth/login
   * Đăng nhập và nhận JWT token (yêu cầu email đã được xác thực).
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
   * Hủy bỏ phiên đăng nhập và xóa thông tin phiên ở client.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout() {
    return {
      success: true,
      message: 'Đăng xuất thành công.',
    };
  }
}
