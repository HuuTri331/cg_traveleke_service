// import { Module } from '@nestjs/common';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm';

// import { AppController } from './app.controller';
// import { AppService } from './app.service';
// import { HealthModule } from './health/health.module';
// import { HotelsModule } from './hotels/hotels.module';
// import { RoomsModule } from './rooms/rooms.module';
// import { UsersModule } from './users/users.module';
// import { BookingsModule } from './bookings/bookings.module';

// @Module({
//   imports: [
//     ConfigModule.forRoot({
//       isGlobal: true,
//     }),

//     TypeOrmModule.forRootAsync({
//       inject: [ConfigService],

//       useFactory: (configService: ConfigService) => ({
//         type: 'mysql',

//         host: configService.get<string>('DB_HOST') ?? '127.0.0.1',

//         port: Number(configService.get<string>('DB_PORT') ?? 3306),

//         username: configService.getOrThrow<string>('DB_USERNAME'),

//         password: configService.getOrThrow<string>('DB_PASSWORD'),

//         database: configService.getOrThrow<string>('DB_DATABASE'),

//         autoLoadEntities: true,

//         synchronize: false,
//       }),
//     }),

//     HealthModule,
//     UsersModule,
//     HotelsModule,
//     RoomsModule,
//   ],

//   controllers: [AppController],
//   providers: [AppService],
// })
// export class AppModule {}

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HotelsModule } from './hotels/hotels.module';
import { RoomsModule } from './rooms/rooms.module';
import { UsersModule } from './users/users.module';
import { BookingsModule } from './bookings/bookings.module';
import { MailModule } from './mail/mail.module';

import { HotelStaffModule } from './hotel-staff/hotel-staff.module';
import { ServicesModule } from './services/services.module';
import { AuditModule } from './audit/audit.module';
import { UserContextMiddleware } from './audit/user-context.middleware';
import { UserContextInterceptor } from './audit/user-context.interceptor';
import { RedisModule } from './redis/redis.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AnalyticsModule } from './analytics/analytics.module';
import {
  ObservabilityModule,
  LoggingInterceptor,
} from './observability/observability.module';
import { IdModule } from './common/id/id.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    // ============================================================
    // ENV
    // ============================================================
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // ============================================================
    // DATABASE MYSQL
    // ============================================================
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        type: 'mysql',

        host: configService.get<string>('DB_HOST') ?? '127.0.0.1',

        port: Number(configService.get<string>('DB_PORT') ?? 3306),

        username: configService.getOrThrow<string>('DB_USERNAME'),

        password: configService.getOrThrow<string>('DB_PASSWORD'),

        database: configService.getOrThrow<string>('DB_DATABASE'),

        autoLoadEntities: true,

        // Database đã tạo bằng SQL
        // nên không cho TypeORM tự thay đổi bảng
        synchronize: false,
      }),
    }),

    // ============================================================
    // MODULES
    // ============================================================
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    HotelsModule,
    RoomsModule,
    BookingsModule,
    HotelStaffModule,
    ServicesModule,
    MailModule,
    RedisModule,
    RateLimitModule,
    AnalyticsModule,
    ObservabilityModule,
    IdModule,
    RealtimeModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: UserContextInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Áp dụng UserContextMiddleware thiết lập AsyncLocalStorage context cho toàn bộ routes
    consumer.apply(UserContextMiddleware).forRoutes('*');
  }
}
