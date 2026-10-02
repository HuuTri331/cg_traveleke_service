import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { MailService } from '../mail/mail.service';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import {
  RefreshToken,
  RefreshTokenStatus,
} from './entities/refresh-token.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { logWithTrace } from '../observability/trace-logger';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';

export interface AuthTokenPayload {
  access_token: string;
  refresh_token?: string;
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
    'hotels.create',
    'hotels.read',
    'hotels.update',
    'hotels.delete',
    'hotels.manage_images',
    'rooms.create',
    'rooms.read',
    'rooms.update',
    'rooms.delete',
    'rooms.manage_images',
    'bookings.read',
    'bookings.update_status',
    'bookings.delete',
    'users.read',
    'users.create',
    'users.update',
    'users.delete',
    'users.manage_staff',
    'users.update_role',
    'users.update_status',
  ],
  EMPLOYEE: [
    'hotels.create',
    'hotels.read',
    'hotels.update',
    'hotels.manage_images',
    'rooms.create',
    'rooms.read',
    'rooms.update',
    'rooms.manage_images',
    'bookings.read',
    'bookings.update_status',
  ],
  CUSTOMER: [],
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTableExists();
  }

  /**
   * Khởi tạo bảng refresh_tokens nếu chưa tồn tại trong CSDL MySQL
   */
  async ensureTableExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NOT NULL,
          session_id VARCHAR(64) NOT NULL,
          family_id VARCHAR(64) NOT NULL,
          token_hash VARCHAR(128) NOT NULL,
          parent_token_id BIGINT UNSIGNED NULL,
          status ENUM('ACTIVE', 'USED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL,
          revoked_at DATETIME NULL,
          absolute_expires_at DATETIME NOT NULL,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_rf_token_hash (token_hash),
          INDEX idx_rf_family_id (family_id),
          INDEX idx_rf_user_id (user_id),
          INDEX idx_rf_session_id (session_id),
          INDEX idx_rf_status_expires (status, expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      this.logger.log('Bảng refresh_tokens đã được khởi tạo/xác thực.');
    } catch (err: any) {
      this.logger.warn(`Không thể khởi tạo bảng refresh_tokens: ${err.message}`);
    }
  }

  /**
   * Băm mật mã Opaque Token bằng SHA-256 để lưu trữ an toàn trong Database.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }


  /**
   * Đăng ký tài khoản khách hàng mới và gửi link xác thực qua Gmail.
   */
  async register(dto: RegisterDto, avatarUrl?: string) {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    if (existing) {
      throw new ConflictException(
        'Email này đã được sử dụng bởi tài khoản khác.',
      );
    }

    const customerRole = await this.rolesRepository.findOne({
      where: { name: 'CUSTOMER' },
    });

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
      role: 'CUSTOMER',
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
    } catch (mailError: any) {
      // Log lỗi nhưng không hủy tài khoản vừa tạo để khách hàng có thể dùng nút "Gửi lại link xác thực"
      logWithTrace('error', 'Lỗi khi gửi email xác thực lúc đăng ký', {
        email: saved.email,
        error:
          mailError instanceof Error ? mailError.message : String(mailError),
      });
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
      throw new NotFoundException(
        'Không tìm thấy tài khoản người dùng tương ứng.',
      );
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
      message:
        'Xác thực tài khoản thành công! Bạn có thể đăng nhập ngay bây giờ.',
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
      throw new NotFoundException(
        'Không tìm thấy tài khoản với địa chỉ email này.',
      );
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException(
        'Tài khoản này đã được xác thực email từ trước.',
      );
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
      message:
        'Đã gửi lại liên kết xác thực tới email của bạn. Vui lòng kiểm tra hộp thư.',
    };
  }

  /**
   * Xác thực email & password, phát hành Access Token ngắn hạn và Opaque Refresh Token
   * gắn với Session ID và Family ID phục vụ Token Rotation Engine.
   */
  async login(
    dto: LoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthTokenPayload> {
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
        message:
          'Tài khoản chưa được xác thực email. Vui lòng kiểm tra email hoặc nhấn gửi lại link xác thực.',
        requiresVerification: true,
        email: user.email,
      });
    }

    // Cập nhật last_login_at
    await this.usersRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    // Khởi tạo Session ID và Family ID độc nhất
    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();

    // Access Token ngắn hạn (Mặc định 15 phút theo kiến trúc BFF)
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: accessExpiresIn as any,
    });

    // Tạo Opaque Refresh Token có độ hỗn loạn mật mã học cao (48 bytes base64url)
    const rawRefreshToken = crypto.randomBytes(48).toString('base64url');
    const tokenHash = this.hashToken(rawRefreshToken);

    const now = new Date();
    const refreshTtlDays = Number(
      this.configService.get<number>('JWT_REFRESH_EXPIRES_DAYS') ?? 7,
    );
    const absoluteLifetimeDays = Number(
      this.configService.get<number>('SESSION_ABSOLUTE_LIFETIME_DAYS') ?? 30,
    );

    const expiresAt = new Date(now.getTime() + refreshTtlDays * 86400000);
    const absoluteExpiresAt = new Date(
      now.getTime() + absoluteLifetimeDays * 86400000,
    );

    const refreshTokenRecord = this.refreshTokenRepository.create({
      userId: user.id,
      sessionId,
      familyId,
      tokenHash,
      parentTokenId: null,
      status: RefreshTokenStatus.ACTIVE,
      expiresAt,
      usedAt: null,
      revokedAt: null,
      absoluteExpiresAt,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    });

    await this.refreshTokenRepository.save(refreshTokenRecord);

    const userProfile = this.getMe(user);

    return {
      access_token,
      refresh_token: rawRefreshToken,
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
      user: userProfile,
    };
  }

  /**
   * Cơ chế Token Rotation Engine với Reuse Detection (Theft Detection):
   * Mỗi Refresh Token chỉ được sử dụng 1 lần duy nhất (Single-Use).
   * Khi phát hiện Token cũ (USED hoặc REVOKED) bị gửi lại, hệ thống lập tức
   * vô hiệu hóa toàn bộ Token Family tương ứng để bảo vệ người dùng khỏi tấn công Replay Attack.
   */
  async rotateRefreshToken(
    rawToken: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Mã Refresh Token không hợp lệ.');
    }

    const tokenHash = this.hashToken(rawToken);

    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException(
        'Mã Refresh Token không tồn tại hoặc đã bị hủy.',
      );
    }

    // ============================================================
    // THEFT / REUSE DETECTION:
    // Nếu token đã USED hoặc REVOKED xuất hiện trở lại -> Tấn công Token Theft / Replay!
    // ============================================================
    if (
      tokenRecord.status === RefreshTokenStatus.USED ||
      tokenRecord.status === RefreshTokenStatus.REVOKED
    ) {
      logWithTrace(
        'warn',
        '[SECURITY ALERT] Phát hiện Refresh Token đã qua sử dụng bị gửi lại (Token Reuse / Replay Attack). Đang thu hồi toàn bộ Token Family!',
        {
          userId: tokenRecord.userId,
          sessionId: tokenRecord.sessionId,
          familyId: tokenRecord.familyId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      );

      // Thu hồi toàn bộ Token Family
      await this.refreshTokenRepository.update(
        { familyId: tokenRecord.familyId },
        {
          status: RefreshTokenStatus.REVOKED,
          revokedAt: new Date(),
        },
      );

      throw new UnauthorizedException(
        'Cảnh báo an ninh: Phiên làm việc của bạn có dấu hiệu bị can thiệp trái phép (Token Replay). Toàn bộ phiên đã bị hủy bỏ. Vui lòng đăng nhập lại.',
      );
    }

    // Kiểm tra hết hạn TTL tương đối hoặc Absolute Session Lifetime
    const now = new Date();
    if (
      tokenRecord.status === RefreshTokenStatus.EXPIRED ||
      tokenRecord.expiresAt.getTime() < now.getTime() ||
      tokenRecord.absoluteExpiresAt.getTime() < now.getTime()
    ) {
      await this.refreshTokenRepository.update(tokenRecord.id, {
        status: RefreshTokenStatus.EXPIRED,
      });
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      );
    }

    // Kiểm tra tài khoản người dùng
    const user = await this.usersRepository.findOne({
      where: { id: tokenRecord.userId },
    });

    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc đã bị khóa.',
      );
    }

    // ============================================================
    // ATOMIC TOKEN ROTATION TRONG DATABASE TRANSACTION
    // ============================================================
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(RefreshToken);

        // 1. Đánh dấu token cũ là USED
        await repo.update(tokenRecord.id, {
          status: RefreshTokenStatus.USED,
          usedAt: now,
        });

        // 2. Tạo successor Refresh Token mới thuộc cùng Family
        const newRawRefreshToken = crypto.randomBytes(48).toString('base64url');
        const newTokenHash = this.hashToken(newRawRefreshToken);

        const refreshTtlDays = Number(
          this.configService.get<number>('JWT_REFRESH_EXPIRES_DAYS') ?? 7,
        );
        let newExpiresAt = new Date(now.getTime() + refreshTtlDays * 86400000);
        // Không vượt quá Absolute Session Expiration
        if (newExpiresAt.getTime() > tokenRecord.absoluteExpiresAt.getTime()) {
          newExpiresAt = tokenRecord.absoluteExpiresAt;
        }

        const successor = repo.create({
          userId: user.id,
          sessionId: tokenRecord.sessionId,
          familyId: tokenRecord.familyId,
          tokenHash: newTokenHash,
          parentTokenId: tokenRecord.id,
          status: RefreshTokenStatus.ACTIVE,
          expiresAt: newExpiresAt,
          usedAt: null,
          revokedAt: null,
          absoluteExpiresAt: tokenRecord.absoluteExpiresAt,
          ipAddress: meta?.ipAddress ?? null,
          userAgent: meta?.userAgent ?? null,
        });

        await repo.save(successor);

        // 3. Ký Access Token ngắn hạn mới
        const accessExpiresIn =
          this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';

        const access_token = this.jwtService.sign(
          {
            sub: user.id,
            email: user.email,
            role: user.role,
            sessionId: tokenRecord.sessionId,
          },
          { expiresIn: accessExpiresIn as any },
        );

        return {
          access_token,
          refresh_token: newRawRefreshToken,
          token_type: 'Bearer',
          expires_in: accessExpiresIn,
          user: this.getMe(user),
        };
      },
      { contextName: 'AuthService.rotateRefreshToken' },
    );

    return result;
  }

  /**
   * Đăng xuất và thu hồi phiên làm việc (Revoke Session & Token Family)
   */
  async logout(rawRefreshToken?: string, sessionId?: string, userId?: string) {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      const token = await this.refreshTokenRepository.findOne({
        where: { tokenHash },
      });
      if (token) {
        await this.refreshTokenRepository.update(
          { familyId: token.familyId },
          { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
        );
      }
    } else if (sessionId) {
      await this.refreshTokenRepository.update(
        { sessionId },
        { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      );
    } else if (userId) {
      await this.refreshTokenRepository.update(
        { userId, status: RefreshTokenStatus.ACTIVE },
        { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      );
    }

    return {
      success: true,
      message: 'Đăng xuất thành công. Phiên làm việc đã bị hủy bỏ an toàn.',
    };
  }

  /**
   * Thu hồi toàn bộ phiên đăng nhập trên tất cả thiết bị của người dùng
   */
  async logoutAll(userId: string) {
    await this.refreshTokenRepository.update(
      { userId, status: RefreshTokenStatus.ACTIVE },
      { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    );
    return {
      success: true,
      message: 'Đã hủy bỏ toàn bộ phiên làm việc trên mọi thiết bị.',
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

