import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserContextService, UserContextStore } from './user-context.service';

@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  constructor(private readonly userContextService: UserContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Trích xuất userId nếu request đã qua Authentication Guard
    const user = request.user;
    const userId = user?.id ? String(user.id) : (user?.sub ? String(user.sub) : undefined);

    const existingStore = this.userContextService.getStore();

    const store: UserContextStore = {
      userId: userId || existingStore?.userId,
      ipAddress:
        existingStore?.ipAddress ||
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip ||
        request.socket?.remoteAddress,
      userAgent: existingStore?.userAgent || (request.headers['user-agent'] as string),
      requestId:
        existingStore?.requestId ||
        (request.headers['x-request-id'] as string) ||
        `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    };

    // Nếu đã có context từ middleware, chỉ cần cập nhật userId
    if (existingStore) {
      if (userId) {
        this.userContextService.setUserId(userId);
      }
      return next.handle();
    }

    // Nếu chạy qua con đường không có middleware (ví dụ microservice, websocket, test), run store mới
    return new Observable((subscriber) => {
      this.userContextService.run(store, () => {
        next
          .handle()
          .subscribe({
            next: (res) => subscriber.next(res),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
      });
    });
  }
}
