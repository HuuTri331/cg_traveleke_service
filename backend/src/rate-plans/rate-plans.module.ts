import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateCalendar, RatePlan } from './entities/rate-plan.entity';
import { RatePlansController } from './rate-plans.controller';
import { RateResolverService } from './rate-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([RatePlan, RateCalendar])],
  controllers: [RatePlansController],
  providers: [RateResolverService],
  exports: [RateResolverService],
})
export class RatePlansModule {}
