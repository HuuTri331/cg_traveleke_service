import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { MailService } from '../mail/mail.service';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
  address: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  isEmailVerified: boolean;
  emailVerifiedAt: Date | null;
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
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Đăng ký tài khoản khách hàng mới và gửi link xác thực qua Gmail.
   */
  async register(dto: RegisterDto, avatarUrl?: string) {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    if (existing) {
      throw new ConflictException('Email này đã được sử dụng bởi tài khoản khác.');
    }

    const customerRole = await this.rolesRepository.findOne({ where: { name: 'CUSTOMER' } });

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = this.usersRepository.create({
      fullName: dto.fullName,
      email: dto.email,
      password: hashedPassword,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      avatarUrl: avatarUrl ?? null,
      status: 'ACTIVE',
      emailVerifiedAt: null,
      roles: customerRole ? [customerRole] : [],
    });

    const saved = await this.usersRepository.save(user);

    // Tạo JWT token xác thực email (thời hạn 24h)
    const verificationToken = this.jwtService.sign(
      {
        sub: saved.id,
        email: saved.email,
        type: 'EMAIL_VERIFICATION',
      },
      { expiresIn: '24h' },
    );

    // Bắn email xác thực tài khoản qua Gmail SMTP
    try {
      await this.mailService.sendVerificationEmail(
        saved.email,
        saved.fullName,
        verificationToken,
      );
    } catch (mailError) {
      // Log lỗi nhưng không hủy tài khoản vừa tạo để khách hàng có thể dùng nút "Gửi lại link xác thực"
      console.error('Lỗi khi gửi email xác thực lúc đăng ký:', mailError);
    }

    return {
      userId: saved.id,
      fullName: saved.fullName,
      email: saved.email,
      requiresVerification: true,
      isEmailVerified: false,
    };
  }

  /**
   * Xác thực tài khoản email thông qua token từ liên kết được gửi tới Gmail.
   */
  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Mã token xác thực không được để trống.');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new BadRequestException(
        'Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu gửi lại email xác thực.',
      );
    }

    if (payload?.type !== 'EMAIL_VERIFICATION') {
      throw new BadRequestException('Loại mã token xác thực không hợp lệ.');
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.sub, email: payload.email },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng tương ứng.');
    }

    if (user.emailVerifiedAt) {
      return {
        success: true,
        message: 'Tài khoản của bạn đã được xác thực trước đó.',
        alreadyVerified: true,
        email: user.email,
      };
    }

    // Cập nhật email_verified_at
    user.emailVerifiedAt = new Date();
    await this.usersRepository.save(user);

    return {
      success: true,
      message: 'Xác thực tài khoản thành công! Bạn có thể đăng nhập ngay bây giờ.',
      email: user.email,
    };
  }

  /**
   * Gửi lại email xác thực cho khách hàng chưa xác thực.
   */
  async resendVerification(email: string) {
    if (!email) {
      throw new BadRequestException('Vui lòng cung cấp địa chỉ email.');
    }

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản với địa chỉ email này.');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException('Tài khoản này đã được xác thực email từ trước.');
    }

    const verificationToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        type: 'EMAIL_VERIFICATION',
      },
      { expiresIn: '24h' },
    );

    await this.mailService.sendVerificationEmail(
      user.email,
      user.fullName,
      verificationToken,
    );

    return {
      success: true,
      message: 'Đã gửi lại liên kết xác thực tới email của bạn. Vui lòng kiểm tra hộp thư.',
    };
  }

  /**
   * Xác thực email & password, trả về JWT access token.
   * Chặn tài khoản CUSTOMER chưa xác thực email.
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

    // Kiểm tra xác thực email đối với tài khoản CUSTOMER
    if (user.role === 'CUSTOMER' && !user.emailVerifiedAt) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Tài khoản chưa được xác thực email. Vui lòng kiểm tra email hoặc nhấn gửi lại link xác thực.',
        requiresVerification: true,
        email: user.email,
      });
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
      address: user.address,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      isEmailVerified: !!user.emailVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      permissions,
    };
  }
}
