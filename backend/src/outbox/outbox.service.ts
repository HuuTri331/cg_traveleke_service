import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OutboxEvent, OutboxEventStatus } from './entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly dataSource: DataSource,
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
   * Section 15: Atomic DB Claim với FOR UPDATE SKIP LOCKED
   * 1. Phục hồi các job PROCESSING bị treo quá lâu (lease timeout 60s) về PENDING
   * 2. Claim các pending rows và chuyển sang PROCESSING trong 1 transaction an toàn
   */
  async claimPendingEvents(
    workerId = 'WorkerInstance-1',
    limit = 20,
  ): Promise<OutboxEvent[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();
      const staleLeaseThreshold = new Date(now.getTime() - 60 * 1000); // 60s lease timeout

      // 1. Recover stale processing events
      await queryRunner.manager
        .createQueryBuilder()
        .update(OutboxEvent)
        .set({
          status: OutboxEventStatus.PENDING,
          lockedAt: null,
          lockedBy: null,
        })
        .where('status = :status', { status: OutboxEventStatus.PROCESSING })
        .andWhere('locked_at < :threshold', { threshold: staleLeaseThreshold })
        .execute();

      // 2. Select pending events with FOR UPDATE SKIP LOCKED
      const events = await queryRunner.manager
        .createQueryBuilder(OutboxEvent, 'e')
        .where('e.status = :status', { status: OutboxEventStatus.PENDING })
        .andWhere('e.available_at <= :now', { now })
        .orderBy('e.created_at', 'ASC')
        .take(limit)
        .setLock('pessimistic_partial_write')
        .getMany();

      if (events.length > 0) {
        const ids = events.map((e) => e.id);
        await queryRunner.manager
          .createQueryBuilder()
          .update(OutboxEvent)
          .set({
            status: OutboxEventStatus.PROCESSING,
            lockedAt: now,
            lockedBy: workerId,
          })
          .whereInIds(ids)
          .execute();
      }

      await queryRunner.commitTransaction();
      return events;
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`[OutboxClaim] Lỗi atomic claim: ${err.message}`);
      return [];
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Giữ phương thức fetchPendingEvents tương thích
   */
  async fetchPendingEvents(limit = 20): Promise<OutboxEvent[]> {
    return this.claimPendingEvents('DefaultWorker', limit);
  }

  async markProcessing(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: OutboxEventStatus.PROCESSING,
      lockedAt: new Date(),
    });
  }

  async markCompleted(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: OutboxEventStatus.COMPLETED,
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
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
      lockedAt: null,
      lockedBy: null,
    });
  }
}
