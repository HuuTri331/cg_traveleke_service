import { createLogger, format, transports } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'refreshtoken',
  'secret',
  'jwt',
  'authorization',
  'cookie',
  'cardnumber',
  'cvv',
]);

/**
 * Đệ quy loại bỏ hoặc che giấu các trường dữ liệu nhạy cảm
 */
function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object' || obj instanceof Date) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = redactSensitiveData(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

// Custom format tự động làm sạch dữ liệu trước khi serialize mà vẫn giữ nguyên các Symbol của Winston
const redactFormat = format((info) => {
  for (const [key, value] of Object.entries(info)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      info[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      info[key] = redactSensitiveData(value);
    }
  }
  return info;
});

// Đảm bảo thư mục logs/ tồn tại nếu ghi file
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // ignore
  }
}

export const logger = createLogger({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  defaultMeta: {
    service: process.env.OTEL_SERVICE_NAME || 'traveleke-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: true }),
    redactFormat(),
    format.json(),
  ),
  transports: [
    new transports.Console({
      handleExceptions: true,
      format:
        process.env.NODE_ENV === 'production'
          ? format.combine(redactFormat(), format.json())
          : format.combine(
              format.colorize(),
              format.timestamp({ format: 'HH:mm:ss' }),
              format.printf((info) => {
                const { level, message, timestamp, context, trace_id } = info;
                const ctx = context ? ` [${context}]` : '';
                const traceInfo = trace_id ? ` (trace: ${trace_id})` : '';
                return `[Traveleke] ${timestamp} ${level}${ctx}: ${message}${traceInfo}`;
              }),
            ),
    }),
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join(logsDir, 'application.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});
