import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  console.log(`API running at http://localhost:${port}/api`);
}

void bootstrap();
