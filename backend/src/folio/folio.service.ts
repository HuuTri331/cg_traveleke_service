import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking } from '../bookings/entities/booking.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  Folio,
  FolioEntry,
  FolioEntryKind,
  FolioSettlement,
  FolioStatus,
} from './entities/folio.entity';

@Injectable()
export class FolioService {
  constructor(
    @InjectRepository(Folio) private readonly folioRepo: Repository<Folio>,
    @InjectRepository(FolioEntry) private readonly entryRepo: Repository<FolioEntry>,
    @InjectRepository(FolioSettlement) private readonly settlementRepo: Repository<FolioSettlement>,
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  async getOrCreateFolio(bookingId: string, hotelId: string, em?: EntityManager): Promise<Folio> {
    const repo = em ? em.getRepository(Folio) : this.folioRepo;
    let folio = await repo.findOne({ where: { bookingId: String(bookingId) } });
    if (!folio) {
      folio = repo.create({
        bookingId: String(bookingId),
        hotelId: String(hotelId),
        folioNumber: `FOL-${hotelId}-${bookingId}`,
        currency: 'VND',
        status: FolioStatus.OPEN,
        totalDebitVnd: 0,
        totalPaymentVnd: 0,
        totalCreditVnd: 0,
        totalRefundVnd: 0,
        outstandingBalanceVnd: 0,
        version: 1,
      });
      folio = await repo.save(folio);
    }
    return folio;
  }

  private recomputeBalances(folio: Folio, entries: FolioEntry[]): Folio {
    let debit = 0;
    let payment = 0;
    let credit = 0;
    let refund = 0;
    for (const e of entries) {
      const amt = Math.round(Number(e.amountVnd || 0));
      if (e.direction === 'DEBIT') debit += amt;
      else if (e.direction === 'PAYMENT') payment += amt;
      else if (e.direction === 'CREDIT') credit += amt;
      else if (e.direction === 'REFUND') refund += amt;
    }
    folio.totalDebitVnd = debit;
    folio.totalPaymentVnd = payment;
    folio.totalCreditVnd = credit;
    folio.totalRefundVnd = refund;
    folio.outstandingBalanceVnd = debit - payment - credit + refund;
    if (folio.status !== FolioStatus.CLOSED) {
      folio.status = folio.outstandingBalanceVnd <= 0 && debit > 0 ? FolioStatus.SETTLED : FolioStatus.OPEN;
    }
    return folio;
  }

  async postEntryOnce(
    params: {
      bookingId: string;
      hotelId: string;
      entryKind: FolioEntryKind;
      direction: 'DEBIT' | 'PAYMENT' | 'CREDIT' | 'REFUND';
      amountVnd: number;
      sourceType: string;
      sourceId: string;
      description: string;
      actorId?: string | null;
      approvedBy?: string | null;
      reversesEntryId?: string | null;
      idempotencyKey?: string;
    },
    em?: EntityManager,
  ): Promise<{ folio: Folio; entry: FolioEntry }> {
    const runner = em || this.dataSource.manager;
    const amt = this.propertyClock.assertValidVndAmount(params.amountVnd, false);
    const idemKey =
      (params.idempotencyKey || '').trim() ||
      `${params.sourceType}:${params.sourceId}:${params.entryKind}`;

    const existing = await runner.getRepository(FolioEntry).findOne({
      where: [
        { idempotencyKey: idemKey },
        {
          sourceType: params.sourceType,
          sourceId: String(params.sourceId),
          entryKind: params.entryKind,
        },
      ],
    });
    if (existing) {
      const folio = await this.getOrCreateFolio(params.bookingId, params.hotelId, runner);
      return { folio, entry: existing };
    }

    const folio = await this.getOrCreateFolio(params.bookingId, params.hotelId, runner);
    if (folio.status === FolioStatus.CLOSED) {
      throw new ConflictException(`FOLIO_ALREADY_CLOSED: Sổ tiền #${folio.folioNumber} đã khóa.`);
    }

    const settings = await this.propertySettings.getHotelSettings(params.hotelId);
    const businessDate = this.propertyClock.resolveBusinessDate(
      new Date(),
      settings.ianaTimezone,
      settings.cutoffTime,
    );

    const entry = await runner.getRepository(FolioEntry).save(
      runner.getRepository(FolioEntry).create({
        folioId: String(folio.id),
        bookingId: String(params.bookingId),
        hotelId: String(params.hotelId),
        entryKind: params.entryKind,
        direction: params.direction,
        amountVnd: amt,
        taxAmountVnd: 0,
        businessDate,
        sourceType: params.sourceType,
        sourceId: String(params.sourceId),
        reversesEntryId: params.reversesEntryId || null,
        description: params.description,
        actorId: params.actorId || null,
        approvedBy: params.approvedBy || null,
        idempotencyKey: idemKey,
      }),
    );

    const allEntries = await runner.getRepository(FolioEntry).find({
      where: { folioId: String(folio.id) },
    });
    this.recomputeBalances(folio, allEntries);
    folio.version += 1;
    const savedFolio = await runner.getRepository(Folio).save(folio);
    return { folio: savedFolio, entry };
  }

  async getBookingFolio(bookingId: string, actor?: { id: string; role: string }) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    if (actor) {
      const role = String(actor.role || '').toUpperCase();
      if (role === 'CUSTOMER' || role === 'USER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException(
            'BOLA_FORBIDDEN: Bạn không có quyền truy cập sổ tiền Folio của khách hàng khác.',
          );
        }
      } else if (role === 'EMPLOYEE' || role === 'STAFF' || role === 'MANAGER') {
        if (typeof this.dataSource?.query === 'function') {
          const staffRows = await this.dataSource.query(
            `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
            [booking.hotelId, actor.id],
          );
          if (!Array.isArray(staffRows) || staffRows.length === 0) {
            throw new ForbiddenException(
              'CROSS_HOTEL_FORBIDDEN: Nhân sự không thuộc khách sạn của đơn đặt phòng này.',
            );
          }
        }
      } else if (role !== 'ADMIN') {
        throw new ForbiddenException('Không có quyền truy cập Folio.');
      }
    }

    const folio = await this.folioRepo.findOne({
      where: { bookingId: String(booking.id) },
    });
    if (!folio) {
      return { folio: null, entries: [], settlements: [] };
    }

    const [entries, settlements] = await Promise.all([
      this.entryRepo.find({ where: { folioId: String(folio.id) }, order: { postedAt: 'ASC', id: 'ASC' } }),
      this.settlementRepo.find({ where: { folioId: String(folio.id) }, order: { createdAt: 'ASC' } }),
    ]);

    const actorRole = String(actor?.role || '').toUpperCase();
    if (actorRole === 'CUSTOMER' || actorRole === 'USER') {
      return {
        folio,
        entries: entries.map((e) => ({
          ...e,
          actorId: null,
          approvedBy: null,
        })),
        settlements: settlements.map((s) => ({
          ...s,
          evidenceUrl: null,
          recordedBy: null,
          providerRef: s.providerRef ? `***${String(s.providerRef).slice(-4)}` : '',
        })),
      };
    }

    return { folio, entries, settlements };
  }

  async recordSettlement(
    folioId: string,
    dto: {
      method: string;
      amountVnd: number;
      providerRef: string;
      evidenceUrl?: string;
      commandId: string;
      approvalRequestId?: string;
      verifiedByGateway?: boolean;
    },
    actor: { id: string; role: string },
  ) {
    const actorRole = String(actor?.role || '').toUpperCase();
    if (!actor?.id || actorRole === 'CUSTOMER' || actorRole === 'USER') {
      throw new ForbiddenException('Khách hàng không được phép tự ghi nhận thu tiền Folio.');
    }
    if (!dto.providerRef?.trim()) {
      throw new BadRequestException('providerRef là bắt buộc.');
    }
    if (!dto.commandId?.trim()) {
      throw new BadRequestException('commandId là bắt buộc.');
    }

    const existing = await this.settlementRepo.findOne({ where: { commandId: dto.commandId.trim() } });
    if (existing) {
      if (String(existing.folioId) !== String(folioId)) {
        throw new ConflictException('commandId đã được sử dụng cho sổ Folio khác.');
      }
      return existing;
    }

    const folio = await this.folioRepo.findOne({ where: { id: String(folioId) } });
    if (!folio) throw new NotFoundException(`Folio #${folioId} không tồn tại.`);

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(folio.bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${folio.bookingId} không tồn tại.`);

    await assertBookingOperator(this.dataSource.manager, booking, actor, 'FOLIO_SETTLEMENT');

    const cleanRef = dto.providerRef.trim();
    const dupProvider = await this.settlementRepo.findOne({
      where: { folioId: String(folio.id), providerRef: cleanRef },
    });
    if (dupProvider && dupProvider.commandId !== dto.commandId.trim()) {
      throw new ConflictException(`DUPLICATE_PROVIDER_REF: Mã giao dịch "${cleanRef}" đã được sử dụng.`);
    }

    let isVerified = Boolean(dto.verifiedByGateway && actorRole === 'ADMIN');
    if (!isVerified && typeof this.dataSource?.query === 'function') {
      const paidTx = await this.dataSource.query(
        `SELECT id FROM payment_transactions WHERE booking_id = ? AND status = 'PAID' AND (txn_ref = ? OR vnp_transaction_no = ?) LIMIT 1`,
        [folio.bookingId, cleanRef, cleanRef],
      );
      isVerified = Array.isArray(paidTx) && paidTx.length > 0;
      if (!isVerified && dto.approvalRequestId) {
        const appRows = await this.dataSource.query(
          `SELECT id FROM approval_requests WHERE id = ? AND hotel_id = ? AND status = 'APPROVED' LIMIT 1`,
          [dto.approvalRequestId, folio.hotelId],
        );
        isVerified = Array.isArray(appRows) && appRows.length > 0;
      }
    }

    const now = new Date();
    const settlementEntity = this.settlementRepo.create({
      folioId: String(folio.id),
      bookingId: String(folio.bookingId),
      hotelId: String(folio.hotelId),
      method: dto.method || 'VN_QR_TRANSFER',
      amountVnd: this.propertyClock.assertValidVndAmount(dto.amountVnd, false),
      providerRef: cleanRef,
      evidenceUrl: dto.evidenceUrl || null,
      status: isVerified ? 'VERIFIED' : 'PENDING_VERIFICATION',
      paidAt: now,
      verifiedAt: isVerified ? now : (null as any),
      recordedBy: String(actor.id),
      commandId: dto.commandId.trim(),
    });
    const settlement = await this.settlementRepo.save(settlementEntity);

    if (isVerified) {
      await this.postEntryOnce({
        bookingId: folio.bookingId,
        hotelId: folio.hotelId,
        entryKind: FolioEntryKind.DESK_SETTLEMENT,
        direction: 'PAYMENT',
        amountVnd: Number(settlement.amountVnd),
        sourceType: 'FOLIO_SETTLEMENT',
        sourceId: String(settlement.id),
        description: `Thanh toán tất toán Folio (${settlement.method} - ${settlement.providerRef})`,
        actorId: actor.id,
        idempotencyKey: `FOLIO_SETTLEMENT:${settlement.id}`,
      });
    }

    return settlement;
  }

  async verifySettlement(settlementId: string, actor: { id: string; role: string }) {
    const actorRole = String(actor?.role || '').toUpperCase();
    if (!actor?.id || actorRole === 'CUSTOMER' || actorRole === 'USER') {
      throw new ForbiddenException('Chỉ Quản lý khách sạn hoặc ADMIN mới có quyền xác nhận thu tiền.');
    }
    const settlement = await this.settlementRepo.findOne({ where: { id: String(settlementId) } });
    if (!settlement) throw new NotFoundException(`Phiếu thu #${settlementId} không tồn tại.`);
    if (actorRole !== 'ADMIN' && typeof this.dataSource?.query === 'function') {
      const mgrRows = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
        [settlement.hotelId, actor.id],
      );
      if (!Array.isArray(mgrRows) || mgrRows.length === 0) {
        throw new ForbiddenException('Chỉ Quản lý khách sạn (MANAGER) mới có quyền xác minh phiếu thu Folio.');
      }
    }
    settlement.status = 'VERIFIED';
    settlement.verifiedAt = new Date();
    await this.settlementRepo.save(settlement);
    await this.postEntryOnce({
      bookingId: settlement.bookingId,
      hotelId: settlement.hotelId,
      entryKind: FolioEntryKind.DESK_SETTLEMENT,
      direction: 'PAYMENT',
      amountVnd: Number(settlement.amountVnd),
      sourceType: 'FOLIO_SETTLEMENT',
      sourceId: String(settlement.id),
      description: `Thanh toán tất toán Folio (${settlement.method} - ${settlement.providerRef})`,
      actorId: actor.id,
      approvedBy: actor.id,
      idempotencyKey: `FOLIO_SETTLEMENT:${settlement.id}`,
    });
    return settlement;
  }

  async postFourEyesAdjustment(
    folioId: string,
    dto: {
      direction: 'CREDIT' | 'DEBIT' | 'REVERSAL';
      amountVnd: number;
      reason: string;
      approvedByManagerId?: string;
      approvalRequestId?: string;
      reversesEntryId?: string;
      commandId: string;
    },
    actor: { id: string; role: string },
  ) {
    const actorRole = String(actor?.role || '').toUpperCase();
    if (!actor?.id || actorRole === 'CUSTOMER' || actorRole === 'USER') {
      throw new ForbiddenException('CUSTOMER_ADJUSTMENT_FORBIDDEN: Khách hàng không được tự điều chỉnh Folio.');
    }
    const mgrId = dto.approvedByManagerId?.trim();
    if ((!mgrId && !dto.approvalRequestId) || (mgrId && String(mgrId) === String(actor.id))) {
      throw new ForbiddenException(
        'FOUR_EYES_ADJUSTMENT_REQUIRED: Điều chỉnh công nợ Folio bắt buộc phải có Quản lý phê duyệt độc lập (4-eyes).',
      );
    }
    const folio = await this.folioRepo.findOne({ where: { id: String(folioId) } });
    if (!folio) throw new NotFoundException(`Folio #${folioId} không tồn tại.`);

    let verifiedApproverId = mgrId || String(dto.approvalRequestId);
    if (typeof this.dataSource?.query === 'function') {
      if (actorRole !== 'ADMIN') {
        const actorStaff = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [folio.hotelId, actor.id],
        );
        if (!Array.isArray(actorStaff) || actorStaff.length === 0) {
          throw new ForbiddenException('CROSS_HOTEL_FORBIDDEN: Nhân sự không thuộc khách sạn của sổ Folio này.');
        }
      }
      if (dto.approvalRequestId) {
        const [app] = await this.dataSource.query(
          `SELECT id, hotel_id AS hotelId, booking_id AS bookingId, requested_by AS requestedBy,
                  reviewed_by AS reviewedBy, amount, status FROM approval_requests WHERE id = ? LIMIT 1`,
          [dto.approvalRequestId],
        );
        if (
          !app || app.status !== 'APPROVED' || String(app.hotelId) !== String(folio.hotelId) ||
          (app.bookingId && String(app.bookingId) !== String(folio.bookingId)) || !app.reviewedBy ||
          String(app.reviewedBy) === String(actor.id) || String(app.requestedBy) === String(app.reviewedBy) ||
          Math.round(Number(app.amount || 0)) !== Math.round(Number(dto.amountVnd || 0))
        ) {
          throw new ForbiddenException('INVALID_APPROVAL_DECISION: Quyết định phê duyệt không hợp lệ hoặc khác phạm vi.');
        }
        verifiedApproverId = String(app.reviewedBy);
      } else if (mgrId) {
        const mgrRows = await this.dataSource.query(
          `SELECT hs.staff_user_id AS managerId FROM hotel_staff hs INNER JOIN users u ON u.id = hs.staff_user_id
           WHERE hs.hotel_id = ? AND hs.staff_user_id = ? AND hs.staff_role = 'MANAGER'
             AND hs.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL LIMIT 1`,
          [folio.hotelId, mgrId],
        );
        if (!Array.isArray(mgrRows) || mgrRows.length === 0) {
          throw new ForbiddenException('INVALID_MANAGER_APPROVAL: Người duyệt không phải Quản lý ACTIVE tại khách sạn này.');
        }
      }
    }

    let effectiveDirection: 'DEBIT' | 'CREDIT' = dto.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    let effectiveAmount = dto.amountVnd;
    if (dto.direction === 'REVERSAL') {
      if (!dto.reversesEntryId) throw new BadRequestException('REVERSAL_REQUIRES_ENTRY_ID: Bắt buộc chỉ định reversesEntryId.');
      const origEntry = await this.entryRepo.findOne({ where: { id: String(dto.reversesEntryId) } });
      if (!origEntry || String(origEntry.folioId) !== String(folio.id)) {
        throw new NotFoundException('Bút toán gốc cần đảo không tồn tại trong sổ Folio này.');
      }
      const priorReversal = await this.entryRepo.findOne({
        where: { folioId: String(folio.id), reversesEntryId: String(origEntry.id), entryKind: FolioEntryKind.REVERSAL },
      });
      if (priorReversal && priorReversal.idempotencyKey !== `FOLIO_ADJ:${dto.commandId}`) {
        throw new ConflictException('ENTRY_ALREADY_REVERSED: Bút toán gốc này đã được đảo trước đó.');
      }
      if (origEntry.direction === 'DEBIT') effectiveDirection = 'CREDIT';
      else if (origEntry.direction === 'CREDIT') effectiveDirection = 'DEBIT';
      else throw new ConflictException(`UNSUPPORTED_REVERSAL_DIRECTION: Không hỗ trợ đảo ${origEntry.direction}.`);
      effectiveAmount = Number(origEntry.amountVnd);
    }

    return this.postEntryOnce({
      bookingId: folio.bookingId,
      hotelId: folio.hotelId,
      entryKind: dto.direction === 'REVERSAL' ? FolioEntryKind.REVERSAL : FolioEntryKind.ADJUSTMENT,
      direction: effectiveDirection,
      amountVnd: effectiveAmount,
      sourceType: dto.approvalRequestId ? 'MANUAL_ADJUSTMENT_APPROVAL' : 'MANUAL_ADJUSTMENT',
      sourceId: dto.approvalRequestId ? String(dto.approvalRequestId) : dto.commandId,
      description: dto.reason,
      actorId: actor.id,
      approvedBy: verifiedApproverId,
      reversesEntryId: dto.reversesEntryId || null,
      idempotencyKey: `FOLIO_ADJ:${dto.commandId}`,
    });
  }

  async assertCheckoutAllowed(bookingId: string, em?: EntityManager): Promise<Folio> {
    const repo = em ? em.getRepository(Folio) : this.folioRepo;
    const folio = await repo.findOne({ where: { bookingId: String(bookingId) } });
    if (!folio) {
      return { outstandingBalanceVnd: 0 } as Folio;
    }
    if (Number(folio.outstandingBalanceVnd || 0) > 0) {
      throw new ConflictException(
        `FOLIO_OUTSTANDING_BALANCE: Không thể checkout khi sổ tiền Folio còn công nợ chưa thanh toán (${folio.outstandingBalanceVnd} VND).`,
      );
    }
    return folio;
  }
}
