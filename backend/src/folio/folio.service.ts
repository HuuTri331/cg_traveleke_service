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

  async getBookingFolio(bookingId: string) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    const folio = await this.getOrCreateFolio(booking.id, booking.hotelId);
    const [entries, settlements] = await Promise.all([
      this.entryRepo.find({ where: { folioId: String(folio.id) }, order: { postedAt: 'ASC', id: 'ASC' } }),
      this.settlementRepo.find({ where: { folioId: String(folio.id) }, order: { createdAt: 'ASC' } }),
    ]);
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
    },
    actor: { id: string; role: string },
  ) {
    if (!dto.providerRef || !dto.providerRef.trim()) {
      throw new BadRequestException('providerRef (chứng từ giao dịch) là bắt buộc khi ghi nhận thu tiền Folio.');
    }
    if (!dto.commandId || !dto.commandId.trim()) {
      throw new BadRequestException('commandId là bắt buộc khi ghi nhận thu tiền Folio.');
    }

    const existing = await this.settlementRepo.findOne({ where: { commandId: dto.commandId.trim() } });
    if (existing) return existing;

    const folio = await this.folioRepo.findOne({ where: { id: String(folioId) } });
    if (!folio) throw new NotFoundException(`Folio #${folioId} không tồn tại.`);

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(folio.bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${folio.bookingId} không tồn tại.`);

    await assertBookingOperator(
      this.dataSource.manager,
      booking,
      actor,
      'FOLIO_SETTLEMENT',
    );

    const now = new Date();
    const settlement = await this.settlementRepo.save(
      this.settlementRepo.create({
        folioId: String(folio.id),
        bookingId: String(folio.bookingId),
        hotelId: String(folio.hotelId),
        method: dto.method || 'VN_QR_TRANSFER',
        amountVnd: this.propertyClock.assertValidVndAmount(dto.amountVnd, false),
        providerRef: dto.providerRef.trim(),
        evidenceUrl: dto.evidenceUrl || null,
        status: 'VERIFIED',
        paidAt: now,
        verifiedAt: now,
        recordedBy: String(actor.id),
        commandId: dto.commandId.trim(),
      }),
    );

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

    return settlement;
  }

  async postFourEyesAdjustment(
    folioId: string,
    dto: {
      direction: 'CREDIT' | 'DEBIT' | 'REVERSAL';
      amountVnd: number;
      reason: string;
      approvedByManagerId: string;
      reversesEntryId?: string;
      commandId: string;
    },
    actor: { id: string; role: string },
  ) {
    if (!dto.approvedByManagerId || String(dto.approvedByManagerId) === String(actor.id)) {
      throw new ForbiddenException(
        'FOUR_EYES_ADJUSTMENT_REQUIRED: Điều chỉnh công nợ Folio bắt buộc phải có Quản lý phê duyệt độc lập (4-eyes).',
      );
    }
    const folio = await this.folioRepo.findOne({ where: { id: String(folioId) } });
    if (!folio) throw new NotFoundException(`Folio #${folioId} không tồn tại.`);

    return this.postEntryOnce({
      bookingId: folio.bookingId,
      hotelId: folio.hotelId,
      entryKind: dto.direction === 'REVERSAL' ? FolioEntryKind.REVERSAL : FolioEntryKind.ADJUSTMENT,
      direction: dto.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT',
      amountVnd: dto.amountVnd,
      sourceType: 'MANUAL_ADJUSTMENT',
      sourceId: dto.commandId,
      description: dto.reason,
      actorId: actor.id,
      approvedBy: dto.approvedByManagerId,
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
