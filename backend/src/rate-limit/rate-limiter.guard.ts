import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { RATE_LIMIT_METADATA } from './rate-limit.decorator';
import { RateLimitOptions } from './rate-limit.interface';
import { SLIDING_WINDOW_SCRIPT } from './scripts/sliding-window.script';
import { TOKEN_BUCKET_SCRIPT } from './scripts/token-bucket.script';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    // Nếu route hoặc controller không định nghĩa @RateLimit, bỏ qua
    if (!options) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    // Nhận diện route: ví dụ auth:login hoặc bookings:create
    const controllerName = context
      .getClass()
      .name.replace('Controller', '')
      .toLowerCase();
    const handlerName = context.getHandler().name;
    const route = `${controllerName}:${handlerName}`;

    try {
      /*
       * ----------------------------------------------------
       * TẦNG 1: SLIDING WINDOW LOG THEO IP (Redis Sorted Set)
       * Chống brute-force, scraping, spam anonymous requests
       * ----------------------------------------------------
       */
      if (options.slidingWindow) {
        const { limit, windowMs } = options.slidingWindow;

        // Trích xuất IP an toàn (hỗ trợ reverse proxy / load balancer)
        let rawIp =
          (request.headers['x-forwarded-for'] as string)
            ?.split(',')[0]
            ?.trim() ||
          request.ip ||
          request.socket?.remoteAddress ||
          'unknown';

        // Làm sạch IPv6 prefix
        if (rawIp.startsWith('::ffff:')) {
          rawIp = rawIp.replace('::ffff:', '');
        }

        const key = `rl:ip:${rawIp}:${route}`;
        const now = Date.now();
        const requestId = `${now}:${randomUUID()}`;

        const result = (await this.redis.eval(
          SLIDING_WINDOW_SCRIPT,
          1,
          key,
          String(now),
          String(windowMs),
          String(limit),
          requestId,
        )) as [number, number];

        const [allowed, currentCount] = result;

        // Gắn các Rate Limit header chuẩn RFC vào Response
        response.setHeader('X-RateLimit-IP-Limit', limit);
        response.setHeader(
          'X-RateLimit-IP-Remaining',
          Math.max(0, limit - currentCount),
        );

        if (allowed === 0) {
          const retryAfterSeconds = Math.ceil(windowMs / 1000);
          response.setHeader('Retry-After', retryAfterSeconds);

          this.logger.warn(
            `[RATE_LIMIT_REJECTED_IP] IP=${rawIp} Route=${route} Count=${currentCount}/${limit} Window=${windowMs}ms`,
          );

          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              error: 'Too Many Requests',
              message:
                'Too many requests from this IP. Please try again later.',
              retryAfter: retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      /*
       * ----------------------------------------------------
       * TẦNG 2: TOKEN BUCKET THEO USER (Redis Hash)
       * Cho phép burst traffic hợp lý và hồi phục token liên tục
       * ----------------------------------------------------
       */
      if (options.tokenBucket && request.user) {
        const { capacity, refillRate, cost = 1 } = options.tokenBucket;
        const userId =
          request.user.id ??
          request.user.sub ??
          request.user.userId ??
          'anonymous';

        const key = `rl:user:${userId}:${route}`;
        const currentTime = Date.now() / 1000;

        const result = (await this.redis.eval(
          TOKEN_BUCKET_SCRIPT,
          1,
          key,
          String(capacity),
          String(refillRate),
          String(currentTime),
          String(cost),
        )) as [number, number];

        const [allowed, remaining] = result;

        response.setHeader('X-RateLimit-Limit', capacity);
        response.setHeader('X-RateLimit-Remaining', remaining);

        if (allowed === 0) {
          const retryAfter = Math.ceil(cost / refillRate);
          response.setHeader('Retry-After', retryAfter);

          this.logger.warn(
            `[RATE_LIMIT_REJECTED_USER] User=${userId} Route=${route} Remaining=${remaining}/${capacity}`,
          );

          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              error: 'Too Many Requests',
              message:
                'Rate limit exceeded for this account. Please slow down.',
              retryAfter,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      return true;
    } catch (error) {
      // Nếu là HttpException (do chúng ta cố ý throw 429), rethrow ngay lập tức
      if (error instanceof HttpException) {
        throw error;
      }

      // FAIL-OPEN STRATEGY:
      // Nếu Redis offline, connection timeout hoặc gặp sự cố mạng,
      // ghi nhận log cảnh báo và cho phép request đi tiếp thay vì làm crash hệ thống API.
      this.logger.warn(
        `RateLimiterGuard encountered Redis error: ${error?.message || error}. Operating in FAIL-OPEN mode.`,
      );
      return true;
    }
  }
}
