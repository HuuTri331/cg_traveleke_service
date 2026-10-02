import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions } from './rate-limit.interface';

export const RATE_LIMIT_METADATA = 'RATE_LIMIT_METADATA';

/**
 * Decorator cấu hình Rate Limiting đa tầng cho Controller hoặc Route Handler cụ thể.
 * @param options Cấu hình SlidingWindow (Tầng IP) và/hoặc TokenBucket (Tầng User)
 */
export function RateLimit(options: RateLimitOptions) {
  return SetMetadata(RATE_LIMIT_METADATA, options);
}
