import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { RoomService } from './entities/room-service.entity';
import { ServiceRequest } from './entities/service-request.entity';
import { BookingServiceSnapshot } from './entities/booking-service-snapshot.entity';
import { ServiceRecoveryLog } from './entities/service-recovery-log.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCategory,
      RoomService,
      ServiceRequest,
      BookingServiceSnapshot,
      ServiceRecoveryLog,
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}

