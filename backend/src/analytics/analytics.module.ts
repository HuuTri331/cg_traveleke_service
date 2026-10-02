import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HotelTrackingEntity } from './entities/hotel-tracking.entity';
import { Hotel } from '../hotels/entities/hotel.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HotelTrackingEntity, Hotel]),
    RateLimitModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule implements OnModuleInit {
  constructor(private readonly analyticsService: AnalyticsService) {}

  async onModuleInit() {
    await this.analyticsService.ensureTableExists();
  }
}
