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

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HotelsModule } from './hotels/hotels.module';
import { RoomsModule } from './rooms/rooms.module';
import { UsersModule } from './users/users.module';
import { BookingsModule } from './bookings/bookings.module';

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

        host:
          configService.get<string>('DB_HOST') ??
          '127.0.0.1',

        port: Number(
          configService.get<string>('DB_PORT') ??
            3306,
        ),

        username:
          configService.getOrThrow<string>(
            'DB_USERNAME',
          ),

        password:
          configService.getOrThrow<string>(
            'DB_PASSWORD',
          ),

        database:
          configService.getOrThrow<string>(
            'DB_DATABASE',
          ),

        autoLoadEntities: true,

        // Database đã tạo bằng SQL
        // nên không cho TypeORM tự thay đổi bảng
        synchronize: false,
      }),
    }),

    // ============================================================
    // MODULES
    // ============================================================
    HealthModule,

    AuthModule,

    UsersModule,

    HotelsModule,

    RoomsModule,

    BookingsModule,
  ],

  controllers: [
    AppController,
  ],

  providers: [
    AppService,
  ],
})
export class AppModule {}