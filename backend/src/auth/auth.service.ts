import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';

export interface AuthTokenPayload {
  access_token: string;
  token_type: string;
  expires_in: string;
  user: MeResponse;
}

export interface MeResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  lastLoginAt: Date | null;
  permissions: string[];
}

/**
 * Map quyền hạn cho từng role.
 * ADMIN có toàn bộ quyền, EMPLOYEE chỉ có quyền vận hành.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.delete', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.delete',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status', 'bookings.delete',
    'users.read', 'users.create', 'users.update', 'users.delete',
    'users.manage_staff', 'users.update_role', 'users.update_status',
  ],
  EMPLOYEE: [
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status',
  ],
  CUSTOMER: [],
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Xác thực email & password, trả về JWT access token.
   */
  async login(dto: LoginDto): Promise<AuthTokenPayload> {
    // Lấy user kèm password (password dùng select: false nên phải addSelect)
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.roles', 'roles')
      .where('user.email = :email', { email: dto.email })
      .andWhere('user.deleted_at IS NULL')
      .getOne();

    if (!user) {
      throw new NotFoundException(
        'Không tìm thấy tài khoản với email này. Vui lòng kiểm tra lại.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Tài khoản của bạn đã bị khoá. Vui lòng liên hệ quản trị viên.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Mật khẩu không đúng. Vui lòng kiểm tra lại.',
      );
    }

    // Cập nhật last_login_at
    await this.usersRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const expiresIn =
      this.configService.get<string>('JWT_EXPIRES_IN') ?? '7d';

    const userProfile = this.getMe(user);

    return {
      access_token: this.jwtService.sign(payload),
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: userProfile,
    };
  }

  /**
   * Lấy thông tin user đang đăng nhập kèm danh sách permissions.
   */
  getMe(user: User): MeResponse {
    const permissions = ROLE_PERMISSIONS[user.role] ?? [];

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      permissions,
    };
  }
}
