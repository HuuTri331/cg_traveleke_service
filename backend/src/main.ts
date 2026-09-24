// 1. KHỞI TẠO OPENTELEMETRY SDK ĐẦU TIÊN (Trước khi NestJS & các thư viện mạng được load)
import './observability/otel';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';

import { AppModule } from './app.module';
import {
  ObservabilityLoggerService,
  logWithTrace,
} from './observability/observability.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Sử dụng Winston + OpenTelemetry Structured Logger thay thế console mặc định
  const observabilityLogger = app.get(ObservabilityLoggerService);
  app.useLogger(observabilityLogger);

  const configService = app.get(ConfigService);

  // Cung cấp thư mục tĩnh /uploads để xem và tải ảnh
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Tất cả API đều bắt đầu bằng /api
  app.setGlobalPrefix('api');

  // Cho phép frontend Next.js gọi sang backend
  app.enableCors({
    origin:
      configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
    credentials: true,
  });

  // Validate dữ liệu request toàn hệ thống
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT') ?? 3001;

  await app.listen(port);

  logWithTrace(
    'info',
    `Traveleke API running at http://localhost:${port}/api`,
    {
      port,
      prefix: '/api',
    },
  );

  console.log(`\n======================================================`);
  console.log(`🚀 [Traveleke Backend] API is ready and listening!`);
  console.log(`📍 Endpoint: http://localhost:${port}/api`);
  console.log(`🏥 Health:   http://localhost:${port}/api/health`);
  console.log(`======================================================\n`);
}

void bootstrap();
