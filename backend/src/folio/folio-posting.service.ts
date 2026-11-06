import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

@Injectable()
export class FolioPostingService {
  async ensureFolio(em: EntityManager, bookingId: string, hotelId: string): Promise<string> {
    await em.query(
      `INSERT INTO folios (booking_id, hotel_id, currency, status)
       VALUES (?, ?, 'VND', 'OPEN') ON DUPLICATE KEY UPDATE id = id`,
      [bookingId, hotelId],
    );
    const [row] = await em.query(`SELECT id FROM folios WHERE booking_id = ? FOR UPDATE`, [
      bookingId,
    ]);
    return String(row.id);
  }

  async postOnce(
    em: EntityManager,
    args: {
      bookingId: string;
      hotelId: string;
      sourceType: string;
      sourceId: string;
      entryKind: string;
      amountVnd: bigint;
      idempotencyKey: string;
      actorUserId?: string | null;
    },
  ) {
    if (!args.idempotencyKey) {
      throw new ConflictException('FOLIO_IDEMPOTENCY_REQUIRED');
    }
    const folioId = await this.ensureFolio(em, args.bookingId, args.hotelId);

    const existingRows = await em.query(
      `SELECT id, amount_vnd AS amountVnd, source_type AS sourceType, source_id AS sourceId
       FROM folio_entries WHERE idempotency_key = ? LIMIT 1`,
      [args.idempotencyKey],
    );
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      const existing = existingRows[0];
      const existingAmt = BigInt(String(Math.round(Number(existing.amountVnd || 0))));
      if (
        existingAmt !== args.amountVnd ||
        String(existing.sourceType) !== String(args.sourceType) ||
        String(existing.sourceId) !== String(args.sourceId)
      ) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD');
      }
      return { folioId, duplicate: true };
    }

    await em.query(
      `INSERT INTO folio_entries
       (folio_id, booking_id, entry_kind, source_type, source_id, amount_vnd, idempotency_key, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        folioId,
        args.bookingId,
        args.entryKind,
        args.sourceType,
        args.sourceId,
        args.amountVnd.toString(),
        args.idempotencyKey,
        args.actorUserId || null,
      ],
    );
    return { folioId, duplicate: false };
  }

  async getBalance(em: EntityManager, bookingId: string): Promise<bigint> {
    const [r] = await em.query(
      `SELECT COALESCE(SUM(amount_vnd), 0) AS balanceVnd FROM folio_entries WHERE booking_id = ?`,
      [bookingId],
    );
    return BigInt(String(Math.round(Number(r?.balanceVnd || 0))));
  }

  async assertCheckoutBalanceCleared(em: EntityManager, bookingId: string): Promise<void> {
    const balance = await this.getBalance(em, bookingId);
    if (balance > 0n) {
      throw new ConflictException(`FOLIO_OUTSTANDING: ${balance.toString()} VND`);
    }
  }
}
