import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from './redis.constants';

export interface LockHandle {
  acquired: boolean;
  token: string;
  key: string;
  release: () => Promise<boolean>;
}

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  // Lua script atomic release: Chỉ xóa khóa nếu token khớp với owner ban đầu
  private readonly RELEASE_LOCK_LUA = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  /**
   * Xin Distributed Lock trên Redis với TTL định trước.
   *
   * @param resource Tên định danh resource (ví dụ: 'room:123', 'booking:456')
   * @param ttlMs Thời gian tồn tại của lock (milliseconds, mặc định 5000ms)
   * @returns LockHandle chứa token và hàm release()
   */
  async acquireLock(resource: string, ttlMs = 5000): Promise<LockHandle> {
    const key = `lock:${resource}`;
    const token = randomUUID();

    try {
      // SET key token NX PX ttlMs
      const res = await this.redisClient.set(key, token, 'PX', ttlMs, 'NX');
      const acquired = res === 'OK';

      return {
        acquired,
        token,
        key,
        release: async () => this.releaseLock(resource, token),
      };
    } catch (err: any) {
      this.logger.warn(
        `[RedisLock] Không thể thao tác Redis lock cho key "${key}": ${err.message}. Chuyển sang fail-open mode.`,
      );
      // Khi Redis gặp lỗi kết nối, trả về acquired: true để không chặn đứng nghiệp vụ của hệ thống
      return {
        acquired: true,
        token,
        key,
        release: async () => true,
      };
    }
  }

  /**
   * Giải phóng Distributed Lock an toàn thông qua atomic Lua script.
   */
  async releaseLock(resource: string, token: string): Promise<boolean> {
    const key = `lock:${resource}`;
    try {
      const result = await this.redisClient.eval(
        this.RELEASE_LOCK_LUA,
        1,
        key,
        token,
      );
      return result === 1;
    } catch (err: any) {
      this.logger.warn(
        `[RedisLock] Lỗi giải phóng lock cho key "${key}": ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Wrapper thực thi hàm trong phạm vi Critical Section được bảo vệ bởi Distributed Lock.
   * Tự động giải phóng lock dù hàm thành công hay ném ngoại lệ.
   */
  async withLock<T>(
    resource: string,
    ttlMs: number,
    operation: () => Promise<T>,
    options?: {
      maxWaitMs?: number;
      retryIntervalMs?: number;
    },
  ): Promise<T> {
    const maxWaitMs = options?.maxWaitMs ?? 3000;
    const retryIntervalMs = options?.retryIntervalMs ?? 100;
    const startTime = Date.now();

    while (Date.now() - startTime <= maxWaitMs) {
      const lock = await this.acquireLock(resource, ttlMs);
      if (lock.acquired) {
        try {
          return await operation();
        } finally {
          await lock.release();
        }
      }

      // Chưa lấy được lock, chờ một khoảng có jitter trước khi thử lại
      const jitter = Math.floor(Math.random() * 30);
      await new Promise((resolve) =>
        setTimeout(resolve, retryIntervalMs + jitter),
      );
    }

    throw new Error(
      `[RedisLock] Không thể lấy Distributed Lock cho tài nguyên "${resource}" sau ${maxWaitMs}ms. Tài nguyên đang có tranh chấp cao.`,
    );
  }
}
