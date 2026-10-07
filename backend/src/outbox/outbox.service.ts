import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent, OutboxEventStatus } from './entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
  ) {}

  /**
   * Thêm event vào Outbox table trong cùng DB Transaction
   */
  async addEvent(
    manager: EntityManager,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: any,
  ): Promise<OutboxEvent> {
    const repo = manager.getRepository(OutboxEvent);
    const event = repo.create({
      eventType,
      aggregateType,
      aggregateId,
      payload,
      status: OutboxEventStatus.PENDING,
      availableAt: new Date(),
    });
    return await repo.save(event);
  }

  /**
   * Lấy các events cần xử lý (polling worker)
   */
  async fetchPendingEvents(limit = 20): Promise<OutboxEvent[]> {
    return await this.outboxRepo
      .createQueryBuilder('e')
      .where('e.status = :status', { status: OutboxEventStatus.PENDING })
      .andWhere('e.available_at <= :now', { now: new Date() })
      .orderBy('e.created_at', 'ASC')
      .take(limit)
      .getMany();
  }

  async markProcessing(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: OutboxEventStatus.PROCESSING,
    });
  }

  async markCompleted(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: OutboxEventStatus.COMPLETED,
      processedAt: new Date(),
    });
  }

  async markFailed(
    id: string,
    errorMessage: string,
    currentRetry: number,
    maxRetries: number,
  ): Promise<void> {
    const nextRetry = currentRetry + 1;
    const isExhausted = nextRetry >= maxRetries;
    // Exponential backoff for retrying: 2^retry * 10 seconds
    const delayMs = Math.min(300000, Math.pow(2, nextRetry) * 10000);
    const nextAvailable = new Date(Date.now() + delayMs);

    await this.outboxRepo.update(id, {
      status: isExhausted ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING,
      retryCount: nextRetry,
      errorMessage: errorMessage.slice(0, 1000),
      availableAt: nextAvailable,
      processedAt: isExhausted ? new Date() : null,
    });
  }
}
