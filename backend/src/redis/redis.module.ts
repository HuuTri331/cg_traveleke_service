import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

export * from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const host = configService.get<string>('REDIS_HOST') || process.env.REDIS_HOST || '127.0.0.1';
        const port = Number(configService.get<number>('REDIS_PORT') || process.env.REDIS_PORT || 6379);
        const password = configService.get<string>('REDIS_PASSWORD') || process.env.REDIS_PASSWORD || undefined;

        const client = new Redis({
          host,
          port,
          password: password ? password : undefined,
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: (times) => {
            if (times > 5) {
              return 15000;
            }
            return Math.min(times * 1500, 5000);
          },
        });

        // Bắt sự kiện error để Node process không bị unhandled error crash
        client.on('error', (err) => {
          logger.warn(`Redis connection warning: ${err.message}. Rate limiter will operate in fail-open mode.`);
        });

        client.on('connect', () => {
          logger.log(`Redis connected successfully to ${host}:${port}`);
        });

        // Kết nối bất đồng bộ trong background
        client.connect().catch((err) => {
          logger.warn(`Initial Redis connection could not be established (${err.message}). Rate limiter operating in fail-open mode.`);
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
