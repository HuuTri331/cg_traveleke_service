import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

@Injectable()
export class NotificationIntentService {
  async enqueueOnce(
    em: EntityManager,
    e: {
      sourceEventId: string;
      hotelId: string;
      bookingId?: string;
      templateKey: string;
      templateVersion: number;
      recipientKey: string;
      channel: 'EMAIL' | 'IN_APP';
      payload: Record<string, unknown>;
    },
  ) {
    if (!e.sourceEventId || !e.recipientKey) {
      throw Error('INVALID_NOTIFICATION_IDENTITY');
    }
    await em.query(
      `INSERT INTO notification_intents
       (hotel_id, booking_id, source_event_id, template_key, template_version,
        channel, recipient_key, payload_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED')
       ON DUPLICATE KEY UPDATE id = id`,
      [
        e.hotelId,
        e.bookingId || null,
        e.sourceEventId,
        e.templateKey,
        e.templateVersion,
        e.channel,
        e.recipientKey,
        JSON.stringify(e.payload),
      ],
    );
  }
}
