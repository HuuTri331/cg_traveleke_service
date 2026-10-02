import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { UserContextService } from './user-context.service';
import { UserContextInterceptor } from './user-context.interceptor';
import { UserContextMiddleware } from './user-context.middleware';
import { AuditSubscriber } from './subscribers/audit.subscriber';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  providers: [
    UserContextService,
    UserContextInterceptor,
    UserContextMiddleware,
    AuditSubscriber,
  ],
  exports: [
    UserContextService,
    UserContextInterceptor,
    UserContextMiddleware,
    TypeOrmModule,
  ],
})
export class AuditModule {}
