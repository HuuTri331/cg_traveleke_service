import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UserContextService, UserContextStore } from './user-context.service';

@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  constructor(private readonly userContextService: UserContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      '';

    const userAgent = (req.headers['user-agent'] as string) || '';
    const requestId =
      (req.headers['x-request-id'] as string) ||
      `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Gán x-request-id vào header response để dễ trace
    res.setHeader('x-request-id', requestId);

    // Khởi tạo store với thông tin ban đầu (userId có thể cập nhật sau khi JwtAuthGuard chạy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user;
    const userId = user?.id ? String(user.id) : undefined;

    const store: UserContextStore = {
      userId,
      ipAddress: rawIp,
      userAgent,
      requestId,
    };

    this.userContextService.run(store, () => {
      next();
    });
  }
}
