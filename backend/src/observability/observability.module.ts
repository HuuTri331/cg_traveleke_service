import { Global, Module } from '@nestjs/common';
import { ObservabilityLoggerService } from './trace-logger';
import { LoggingInterceptor } from './logging.interceptor';

export * from './logger';
export * from './trace-logger';
export * from './logging.interceptor';

@Global()
@Module({
  providers: [ObservabilityLoggerService, LoggingInterceptor],
  exports: [ObservabilityLoggerService, LoggingInterceptor],
})
export class ObservabilityModule {}
