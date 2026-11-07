import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DataSource, Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string; // user.id
  email: string;
  role: string;
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ hoặc tài khoản đã bị khoá.',
      );
    }

    const runner = this.dataSource || this.usersRepository.manager;
    if (typeof runner?.query === 'function') {
      if (payload.sessionId) {
        const sessionRows = await runner.query(
          `SELECT status FROM refresh_tokens WHERE session_id = ? LIMIT 10`,
          [payload.sessionId],
        );
        if (
          Array.isArray(sessionRows) &&
          sessionRows.length > 0 &&
          !sessionRows.some((r: any) => r.status === 'ACTIVE')
        ) {
          throw new UnauthorizedException(
            'Phiên đăng nhập đã đăng xuất hoặc bị thu hồi. Vui lòng đăng nhập lại.',
          );
        }
      } else {
        const activeRows = await runner.query(
          `SELECT status FROM refresh_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 5`,
          [user.id],
        );
        if (
          Array.isArray(activeRows) &&
          activeRows.length > 0 &&
          activeRows.every((r: any) => r.status === 'REVOKED')
        ) {
          throw new UnauthorizedException(
            'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.',
          );
        }
      }
    }

    return user;
  }
}
