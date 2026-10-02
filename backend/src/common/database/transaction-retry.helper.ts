import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export interface RetryOptions {
  /**
   * Số lần thử lại tối đa khi gặp transient deadlock/lock wait timeout.
   * Default: 3 lần.
   */
  maxRetries?: number;

  /**
   * Thời gian chờ cơ sở (milliseconds).
   * Default: 50ms.
   */
  baseDelayMs?: number;

  /**
   * Thời gian chờ tối đa (milliseconds).
   * Default: 1000ms.
   */
  maxDelayMs?: number;

  /**
   * Jitter ngẫu nhiên tối đa để phá vỡ hiện tượng retry storm / thundering herd.
   * Default: 50ms.
   */
  jitterMs?: number;

  /**
   * Tên ngữ cảnh/nghiệp vụ phục vụ logging.
   */
  contextName?: string;
}

/**
 * Kiểm tra xem lỗi Database có phải là Transient Failure (Deadlock / Lock Timeout) có thể retry an toàn hay không.
 */
export function isTransientDatabaseError(error: any): boolean {
  if (!error) return false;

  const code = error.code || error.driverError?.code || '';
  const errno = error.errno || error.driverError?.errno;
  const sqlState = error.sqlState || error.driverError?.sqlState || '';
  const message = String(error.message || error.driverError?.message || '').toLowerCase();

  // MySQL Error 1213: ER_LOCK_DEADLOCK - Deadlock found when trying to get lock; try restarting transaction
  if (code === 'ER_LOCK_DEADLOCK' || errno === 1213 || sqlState === '40001') {
    return true;
  }

  // MySQL Error 1205: ER_LOCK_WAIT_TIMEOUT - Lock wait timeout exceeded; try restarting transaction
  if (code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205) {
    return true;
  }

  // PostgreSQL Code 40P01: deadlock_detected, 40001: serialization_failure
  if (code === '40P01' || code === '40001') {
    return true;
  }

  // Chuỗi thông báo đặc trưng
  if (
    message.includes('deadlock') ||
    message.includes('lock wait timeout') ||
    message.includes('try restarting transaction')
  ) {
    return true;
  }

  return false;
}

/**
 * Tính toán độ trễ Exponential Backoff kết hợp Random Full Jitter:
 * delay = min(maxDelay, baseDelay * 2^attempt) + random(0, jitter)
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = 50,
  maxDelayMs = 1000,
  jitterMs = 50,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * Math.max(1, jitterMs));
  return exponential + jitter;
}

/**
 * Thực thi một Database Transaction với cơ chế tự động phát hiện Deadlock và Retry
 * sử dụng Exponential Backoff + Jitter.
 *
 * @param dataSource TypeORM DataSource
 * @param operation Callback chứa các thao tác Database trong transaction
 * @param options Cấu hình số lần retry, delay, jitter
 */
export async function runWithDeadlockRetry<T>(
  dataSource: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const logger = new Logger(options?.contextName || 'TransactionRetryHelper');
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 50;
  const maxDelayMs = options?.maxDelayMs ?? 1000;
  const jitterMs = options?.jitterMs ?? 50;

  let attempt = 0;

  while (true) {
    try {
      return await dataSource.transaction(async (manager) => {
        return await operation(manager);
      });
    } catch (err: any) {
      if (isTransientDatabaseError(err) && attempt < maxRetries) {
        attempt++;
        const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterMs);

        logger.warn(
          `[Deadlock/LockTimeout] Gặp xung đột transient trong transaction (lần ${attempt}/${maxRetries}): ${err.message}. Đang áp dụng Backoff + Jitter chờ ${delay}ms trước khi thử lại...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Nếu không phải lỗi transient hoặc đã hết số lượt retry, throw nguyên vẹn
      throw err;
    }
  }
}

/**
 * Deterministic Lock Ordering:
 * Chuẩn hóa thứ tự danh sách ID hoặc đối tượng cần khóa trước khi truy vấn Database
 * để loại bỏ triệt để chu trình phụ thuộc chéo (Dependency Cycle) giữa các Transaction đồng thời.
 */
export function deterministicSort<T>(
  items: T[],
  keyExtractor: (item: T) => string | number,
): T[] {
  return [...items].sort((a, b) => {
    const keyA = keyExtractor(a);
    const keyB = keyExtractor(b);
    if (typeof keyA === 'number' && typeof keyB === 'number') {
      return keyA - keyB;
    }
    return String(keyA).localeCompare(String(keyB));
  });
}
