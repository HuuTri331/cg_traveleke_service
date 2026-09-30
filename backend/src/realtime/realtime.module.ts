import { Module, Global } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventsService } from './realtime-events.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeEventsService],
  exports: [RealtimeGateway, RealtimeEventsService],
})
export class RealtimeModule {}
