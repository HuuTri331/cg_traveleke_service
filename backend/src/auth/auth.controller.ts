import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { AuthService } from './auth.service';
import { EmailSecurityService } from './email-security.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ValidateEmailDto } from './dto/validate-email.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

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
@UseGuards(RateLimiterGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly emailSecurityService: EmailSecurityService,
  ) {}

  /**
   * Lấy địa chỉ IP của Client để quản lý vi phạm và chống spam
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded)) {
      return forwarded[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }

  /**
   * POST /api/auth/validate-email
   * Kiểm tra email có thật không, có tục tĩu/ảo không trước khi đăng ký.
   * Nếu phát hiện vi phạm, hệ thống kích hoạt khóa 10 phút hoặc 10 giờ.
   */
  @Post('validate-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    slidingWindow: {
      limit: 15,
      windowMs: 60_000,
    },
  })
  async validateEmail(@Body() dto: ValidateEmailDto, @Req() req: Request) {
    const clientIp = this.getClientIp(req);
    await this.emailSecurityService.validateEmail(dto.email, clientIp);
    return {
      success: true,
      valid: true,
      message: 'Địa chỉ email hợp lệ.',
    };
  }

  /**
   * POST /api/auth/register
   * Đăng ký tài khoản khách hàng mới (có thể upload avatar).
   * Kiểm tra nghiêm ngặt email tồn tại & không tục tĩu trước khi xử lý.
   * Tầng 1: Sliding Window chống spam tạo account hàng loạt (tối đa 5 req/phút/IP).
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({
    slidingWindow: {
      limit: 5,
      windowMs: 60_000,
    },
  })
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    const clientIp = this.getClientIp(req);

    // 1. Kiểm tra an toàn email và xử lý khóa nếu vi phạm
    await this.emailSecurityService.validateEmail(dto.email, clientIp);

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
   * Giới hạn tối đa 3 lần/phút/IP để tránh spam cạn quota mail service.
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    slidingWindow: {
      limit: 3,
      windowMs: 60_000,
    },
  })
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() req: Request) {
    const clientIp = this.getClientIp(req);
    // Kiểm tra lockout trước khi cho phép gửi lại
    this.emailSecurityService.checkLockout(clientIp);

    const result = await this.authService.resendVerification(dto.email);
    return result;
  }

  /**
   * POST /api/auth/login
   * Đăng nhập và nhận JWT token (yêu cầu email đã được xác thực).
   * Tầng 1: Giới hạn tối đa 10 lần thử/phút/IP chống tấn công vét cạn mật khẩu (Brute-force).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    slidingWindow: {
      limit: 10,
      windowMs: 60_000,
    },
  })
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
