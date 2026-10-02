import { Injectable, LoggerService } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { logger } from './logger';

export type LogMetadata = Record<string, any>;

/**
 * Ghi log có gắn kèm trace_id và span_id hiện tại từ OpenTelemetry (Log-Trace Correlation)
 */
export function logWithTrace(
  level: 'info' | 'warn' | 'error' | 'debug' | 'verbose',
  message: string,
  meta: LogMetadata = {},
) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  logger.log({
    level,
    message,
    ...meta,
    trace_id: spanContext?.traceId || undefined,
    span_id: spanContext?.spanId || undefined,
  });
}

/**
 * NestJS LoggerService Adapter dùng Winston + OpenTelemetry
 * Cho phép toàn bộ Logger trong NestJS tự động xuất log chuẩn Structured JSON và có trace_id
 */
@Injectable()
export class ObservabilityLoggerService implements LoggerService {
  log(message: any, ...optionalParams: any[]) {
    this.writeLog('info', message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]) {
    this.writeLog('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    this.writeLog('warn', message, optionalParams);
  }

  debug?(message: any, ...optionalParams: any[]) {
    this.writeLog('debug', message, optionalParams);
  }

  verbose?(message: any, ...optionalParams: any[]) {
    this.writeLog('verbose', message, optionalParams);
  }

  private writeLog(
    level: 'info' | 'warn' | 'error' | 'debug' | 'verbose',
    message: any,
    params: any[],
  ) {
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();

    const context =
      params.length > 0 && typeof params[params.length - 1] === 'string'
        ? params[params.length - 1]
        : undefined;

    const extra =
      params.length > 0 && typeof params[0] === 'object' ? params[0] : {};

    const formattedMessage =
      typeof message === 'object'
        ? message.message || JSON.stringify(message)
        : String(message);

    logger.log({
      level,
      message: formattedMessage,
      context,
      ...extra,
      trace_id: spanContext?.traceId || undefined,
      span_id: spanContext?.spanId || undefined,
    });
  }
}
