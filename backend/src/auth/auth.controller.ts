import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
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
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/register
   * Đăng ký tài khoản khách hàng mới (có thể kèm avatar).
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
      message: 'Đăng ký tài khoản thành công.',
      data,
    };
  }

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
