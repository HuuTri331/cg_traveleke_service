import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  NotificationDelivery,
  NotificationIntent,
} from './entities/notification-intent.entity';

export function escapeNotificationHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class BookingNotificationsService {
  constructor(
    @InjectRepository(NotificationIntent)
    private readonly intentRepo: Repository<NotificationIntent>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveryRepo: Repository<NotificationDelivery>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Idempotently enqueues a transactional notification intent (IMP-20 / GAP-20).
   * Duplicate VNPay IPNs or worker retries with the same `(sourceEventId, templateKey, channel, recipientKey)`
   * return the existing intent without sending duplicate emails.
   */
  async enqueueIntentOnce(params: {
    bookingId?: string | null;
    hotelId: string;
    sourceEventId: string;
    templateKey: string;
    channel?: 'EMAIL' | 'IN_APP' | 'SMS';
    recipientKey: string;
    payload: Record<string, any>;
  }): Promise<NotificationIntent> {
    const channel = params.channel || 'EMAIL';
    const existing = await this.intentRepo.findOne({
      where: {
        sourceEventId: params.sourceEventId,
        templateKey: params.templateKey,
        channel,
        recipientKey: params.recipientKey,
      },
    });
    if (existing) return existing;

    const sanitizedPayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(params.payload || {})) {
      sanitizedPayload[k] = typeof v === 'string' ? escapeNotificationHtml(v) : v;
    }

    const commandKey = `${params.sourceEventId}:${params.templateKey}:${channel}:${params.recipientKey}`;
    return this.intentRepo.save(
      this.intentRepo.create({
        bookingId: params.bookingId ? String(params.bookingId) : null,
        hotelId: String(params.hotelId),
        sourceEventId: params.sourceEventId,
        templateKey: params.templateKey,
        templateVersion: 1,
        channel,
        recipientKey: params.recipientKey,
        payloadJson: sanitizedPayload,
        status: 'QUEUED',
        retryCount: 0,
        commandKey,
      }),
    );
  }

  async deliverIntent(
    intentId: string,
    providerSimulator?: (intent: NotificationIntent) => Promise<{ providerRef: string }>,
  ): Promise<{ intent: NotificationIntent; delivery: NotificationDelivery }> {
    const intent = await this.intentRepo.findOne({ where: { id: String(intentId) } });
    if (!intent) throw new NotFoundException(`Notification intent #${intentId} không tồn tại.`);
    if (intent.status === 'DELIVERED') {
      const lastDelivery = await this.deliveryRepo.findOne({
        where: { intentId: String(intent.id), status: 'DELIVERED' },
      });
      return { intent, delivery: lastDelivery! };
    }

    const attemptNo = Number(intent.retryCount || 0) + 1;
    try {
      const res = providerSimulator
        ? await providerSimulator(intent)
        : { providerRef: `MSG-${intent.id}-${attemptNo}` };
      const now = new Date();
      intent.status = 'DELIVERED';
      intent.deliveredAt = now;
      intent.lastError = null;
      const savedIntent = await this.intentRepo.save(intent);

      const delivery = await this.deliveryRepo.save(
        this.deliveryRepo.create({
          intentId: String(intent.id),
          attemptNo,
          status: 'DELIVERED',
          providerRef: res.providerRef,
          deliveredAt: now,
        }),
      );
      return { intent: savedIntent, delivery };
    } catch (err: any) {
      intent.retryCount = attemptNo;
      intent.status = attemptNo >= 3 ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
      intent.lastError = String(err?.message || 'PROVIDER_TIMEOUT');
      const savedIntent = await this.intentRepo.save(intent);

      const delivery = await this.deliveryRepo.save(
        this.deliveryRepo.create({
          intentId: String(intent.id),
          attemptNo,
          status: 'FAILED',
          errorCode: 'PROVIDER_ERROR',
          errorMessage: intent.lastError,
        }),
      );
      return { intent: savedIntent, delivery };
    }
  }
}
