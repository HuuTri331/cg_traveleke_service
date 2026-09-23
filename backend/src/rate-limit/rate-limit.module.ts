import { Module } from '@nestjs/common';
import { RateLimiterGuard } from './rate-limiter.guard';
import { RedisModule } from '../redis/redis.module';

export * from './rate-limit.interface';
export * from './rate-limit.decorator';
export * from './rate-limiter.guard';

@Module({
  imports: [RedisModule],
  providers: [RateLimiterGuard],
  exports: [RateLimiterGuard],
})
export class RateLimitModule {}
