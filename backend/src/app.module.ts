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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

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

        synchronize: false,
      }),
    }),

    HealthModule,
    AuthModule,
    UsersModule,
    HotelsModule,
    RoomsModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}


