import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { logWithTrace } from './trace-logger';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { method, originalUrl } = req;
    const startTime = Date.now();

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const user = (req as any).user;
    const userId = user?.id ?? user?.sub ?? null;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode || 200;

        const meta = {
          http: {
            method,
            url: originalUrl,
            status_code: statusCode,
            duration_ms: duration,
          },
          ip: clientIp,
          user_id: userId,
        };

        if (duration > 1500) {
          logWithTrace(
            'warn',
            `[SLOW_REQUEST] ${method} ${originalUrl} ${statusCode} hoàn thành sau ${duration}ms`,
            meta,
          );
        } else {
          logWithTrace(
            'info',
            `${method} ${originalUrl} ${statusCode} - ${duration}ms`,
            meta,
          );
        }
      }),
      catchError((err: any) => {
        const duration = Date.now() - startTime;
        const statusCode =
          err instanceof HttpException
            ? err.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        logWithTrace(
          statusCode >= 500 ? 'error' : 'warn',
          `[HTTP_ERROR] ${method} ${originalUrl} ${statusCode} - ${err?.message || err}`,
          {
            http: {
              method,
              url: originalUrl,
              status_code: statusCode,
              duration_ms: duration,
            },
            ip: clientIp,
            user_id: userId,
            error: {
              name: err?.name || 'Error',
              message: err?.message || String(err),
              stack: statusCode >= 500 ? err?.stack : undefined,
            },
          },
        );

        throw err;
      }),
    );
  }
}
