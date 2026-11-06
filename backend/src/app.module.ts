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
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { OutboxModule } from './outbox/outbox.module';
import { WorkersModule } from './workers/workers.module';
import { CancellationsModule } from './cancellations/cancellations.module';
import { ChatModule } from './chat/chat.module';
import { ShiftsModule } from './shifts/shifts.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { StaffAvailabilityModule } from './staff-availability/staff-availability.module';
import { BookingAssignmentModule } from './booking-assignment/booking-assignment.module';
import { BookingPresenceModule } from './booking-presence/booking-presence.module';
import { BookingCoverageModule } from './booking-coverage/booking-coverage.module';
import { GuestWorkModule } from './guest-work/guest-work.module';
import { GuestConversationsModule } from './guest-conversations/guest-conversations.module';
import { StaffKpiModule } from './staff-kpi/staff-kpi.module';
import { HotelAccessModule } from './common/authz/hotel-access.module';
import { PromotionsModule } from './promotions/promotions.module';
import { PropertySettingsModule } from './property-settings/property-settings.module';
import { RoomUnitsModule } from './room-units/room-units.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { RoomIncidentsModule } from './room-incidents/room-incidents.module';
import { DeskBoardModule } from './desk-board/desk-board.module';
import { RatePlansModule } from './rate-plans/rate-plans.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { BookingAmendmentsModule } from './booking-amendments/booking-amendments.module';
import { FolioModule } from './folio/folio.module';
import { NightAuditModule } from './night-audit/night-audit.module';
import { BookingDocumentsModule } from './booking-documents/booking-documents.module';
import { PrecheckinModule } from './precheckin/precheckin.module';
import { BookingNotificationsModule } from './booking-notifications/notifications.module';

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
    InventoryModule,
    PaymentsModule,
    OutboxModule,
    WorkersModule,
    CancellationsModule,
    ChatModule,
    ShiftsModule,
    ApprovalsModule,
    StaffAvailabilityModule,
    BookingAssignmentModule,
    BookingPresenceModule,
    BookingCoverageModule,
    GuestWorkModule,
    GuestConversationsModule,
    StaffKpiModule,
    HotelAccessModule,
    PromotionsModule,
    PropertySettingsModule,
    RoomUnitsModule,
    HousekeepingModule,
    MaintenanceModule,
    RoomIncidentsModule,
    DeskBoardModule,
    RatePlansModule,
    VouchersModule,
    BookingAmendmentsModule,
    FolioModule,
    NightAuditModule,
    BookingDocumentsModule,
    PrecheckinModule,
    BookingNotificationsModule,
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
