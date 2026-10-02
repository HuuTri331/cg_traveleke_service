import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserContextService, UserContextStore } from './user-context.service';
import { IdGeneratorService } from '../common/id/id-generator.service';

@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  private readonly idGen: IdGeneratorService;

  constructor(
    private readonly userContextService: UserContextService,
    @Optional() idGenerator?: IdGeneratorService,
  ) {
    this.idGen = idGenerator ?? new IdGeneratorService();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Trích xuất userId nếu request đã qua Authentication Guard
    const user = request.user;
    const userId = user?.id
      ? String(user.id)
      : user?.sub
        ? String(user.sub)
        : undefined;

    const existingStore = this.userContextService.getStore();

    const store: UserContextStore = {
      userId: userId || existingStore?.userId,
      ipAddress:
        existingStore?.ipAddress ||
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip ||
        request.socket?.remoteAddress,
      userAgent:
        existingStore?.userAgent || (request.headers['user-agent'] as string),
      requestId:
        existingStore?.requestId ||
        (request.headers['x-request-id'] as string) ||
        this.idGen.generateUuidV7(),
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
        next.handle().subscribe({
          next: (res) => subscriber.next(res),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
