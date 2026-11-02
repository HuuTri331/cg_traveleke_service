import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentTransaction, PaymentTransactionStatus } from '../payments/entities/payment-transaction.entity';
import { Room } from '../rooms/entities/room.entity';
import { ServiceRequest } from '../services/entities/service-request.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  AcceptConsentDto,
  CalculateQuoteDto,
  CreatePromotionCampaignDto,
  RedeemBenefitDto,
  SettleRefundDto,
} from './dto/promotions.dto';
import { BenefitConsentRecord } from './entities/benefit-consent-record.entity';
import { BenefitAccountStatus, BookingBenefitAccount } from './entities/booking-benefit-account.entity';
import { BenefitLedgerEntryType, BookingBenefitLedger } from './entities/booking-benefit-ledger.entity';
import { BookingPriceQuote } from './entities/booking-price-quote.entity';
import {
  BenefitKind, ChargeComponentType, PromotionCampaign, PromotionCampaignStatus,
  PromotionCampaignType, PromotionDiscountType, PromotionTargetScope,
} from './entities/promotion-campaign.entity';
import { PromotionRefundIntent, RefundIntentStatus } from './entities/promotion-refund-intent.entity';
import {
  addDaysToDateStr,
  computeNightlyQuote,
  computeServiceItemPricing,
  detectCampaignConflicts,
  hasRemainingCampaignBudget,
  toLocalHotelDate,
} from './promotion-engine';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(PromotionCampaign) private readonly campaignRepo: Repository<PromotionCampaign>,
    @InjectRepository(BookingPriceQuote) private readonly quoteRepo: Repository<BookingPriceQuote>,
    @InjectRepository(BookingBenefitAccount) private readonly accountRepo: Repository<BookingBenefitAccount>,
    @InjectRepository(BookingBenefitLedger) private readonly ledgerRepo: Repository<BookingBenefitLedger>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingRoom) private readonly bookingRoomRepo: Repository<BookingRoom>,
    @InjectRepository(Room) private readonly roomRepo: Repository<Room>,
    private readonly staffAvailabilityService: StaffAvailabilityService,
    private readonly dataSource: DataSource,
    @Optional() private readonly coverageService?: BookingCoverageService,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  private async assertHotelManager(actor: { id: string; role: string }, hotelId: string) {
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'EMPLOYEE' || !(await this.staffAvailabilityService.isManagerAtHotel(actor.id, hotelId))) {
      throw new ForbiddenException('Chỉ Quản lý khách sạn (MANAGER) của cơ sở này mới có quyền cấu hình/duyệt khuyến mãi.');
    }
  }

  async createCampaign(actor: { id: string; role: string }, dto: CreatePromotionCampaignDto) {
    await this.assertHotelManager(actor, dto.hotelId);
    const stayStartDate = toLocalHotelDate(dto.stayStartDate);
    const stayEndExclusiveDate = dto.stayEndExclusiveDate
      ? toLocalHotelDate(dto.stayEndExclusiveDate)
      : dto.stayEndDate
      ? addDaysToDateStr(toLocalHotelDate(dto.stayEndDate), 1)
      : '';
    if (!stayEndExclusiveDate || stayEndExclusiveDate <= stayStartDate) {
      throw new BadRequestException('Khoảng ngày áp dụng chương trình [stayStartDate, stayEndExclusiveDate) không hợp lệ.');
    }
    const discountType = dto.discountType || PromotionDiscountType.FIXED_AMOUNT;
    if (discountType === PromotionDiscountType.PERCENT && Number(dto.discountValue) > 100) {
      throw new BadRequestException('Mức giảm theo phần trăm (PERCENT) không được vượt quá 100%.');
    }
    if (dto.serviceStartHour !== undefined && dto.serviceEndHour !== undefined) {
      if (
        dto.serviceStartHour < 0 ||
        dto.serviceEndHour > 24 ||
        dto.serviceStartHour >= dto.serviceEndHour
      ) {
        throw new BadRequestException('Khung giờ dịch vụ [serviceStartHour, serviceEndHour) không hợp lệ.');
      }
    }
    const targetScope = dto.targetScope || PromotionTargetScope.ROOM_IDS;
    if (targetScope === PromotionTargetScope.ROOM_IDS && (!dto.targetRoomIds || dto.targetRoomIds.length === 0)) {
      throw new BadRequestException('Phạm vi ROOM_IDS bắt buộc chỉ định ít nhất một phòng.');
    }
    if (targetScope === PromotionTargetScope.SERVICE_IDS && (!dto.targetServiceIds || dto.targetServiceIds.length === 0)) {
      throw new BadRequestException('Phạm vi SERVICE_IDS bắt buộc chỉ định ít nhất một dịch vụ.');
    }
    const candidate = this.campaignRepo.create({
      hotelId: dto.hotelId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(),
      description: dto.description || null,
      campaignType: dto.campaignType || PromotionCampaignType.STAY_DATE,
      status: PromotionCampaignStatus.DRAFT,
      chargeComponentType: dto.chargeComponentType || ChargeComponentType.ROOM_NIGHT,
      targetScope: dto.targetScope || PromotionTargetScope.ROOM_IDS,
      targetRoomIds: dto.targetRoomIds || null, targetServiceIds: dto.targetServiceIds || null,
      stayStartDate, stayEndExclusiveDate,
      serviceStartHour: dto.serviceStartHour ?? null, serviceEndHour: dto.serviceEndHour ?? null,
      discountType: dto.discountType || PromotionDiscountType.FIXED_AMOUNT,
      discountValue: dto.discountValue, floorPrice: dto.floorPrice ?? 0,
      maxDiscountPerNight: dto.maxDiscountPerNight ?? null,
      maxDiscountPerBooking: dto.maxDiscountPerBooking ?? null,
      minNights: dto.minNights ?? 1, minRooms: dto.minRooms ?? 1,
      minGuests: dto.minGuests ?? 1, minOrderAmount: dto.minOrderAmount ?? 0,
      benefitKind: dto.benefitKind || BenefitKind.ROOM_PRICE_ADJUSTMENT,
      existingBookingsEligible: dto.existingBookingsEligible ?? true,
      retroactiveMode: dto.retroactiveMode ?? false,
      budgetTotal: dto.budgetTotal ?? null, maxRedemptions: dto.maxRedemptions ?? null,
      packageConfig: dto.packageConfig || null, version: 1, createdBy: actor.id,
    });
    const activeOrApproved = await this.campaignRepo.find({
      where: { hotelId: dto.hotelId, status: In([PromotionCampaignStatus.APPROVED, PromotionCampaignStatus.SCHEDULED, PromotionCampaignStatus.ACTIVE]) },
    });
    const conflictWarnings = detectCampaignConflicts(candidate, activeOrApproved);
    const saved = await this.campaignRepo.save(candidate);
    return { campaign: saved, conflictWarnings };
  }

  async approveAndActivateCampaign(actor: { id: string; role: string }, campaignId: string) {
    const result = await this.dataSource.transaction(async (em) => {
      const campaign = await em.findOne(PromotionCampaign, {
        where: { id: campaignId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!campaign) throw new NotFoundException(`Không tìm thấy chiến dịch #${campaignId}`);
      await this.assertHotelManager(actor, campaign.hotelId);

      if (![PromotionCampaignStatus.DRAFT, PromotionCampaignStatus.SUBMITTED, PromotionCampaignStatus.APPROVED].includes(campaign.status)) {
        throw new ConflictException(`Không thể kích hoạt chiến dịch từ trạng thái ${campaign.status}`);
      }
      if (campaign.budgetTotal !== null && Number(campaign.budgetTotal) <= 0) {
        throw new BadRequestException('Ngân sách chiến dịch = 0 nên không thể kích hoạt cấp mới.');
      }

      if (em.query) {
        await em.query(
          `INSERT IGNORE INTO hotel_assignment_dispatch_locks (hotel_id, version, updated_at) VALUES (?, 0, NOW())`,
          [campaign.hotelId],
        );
        await em.query(
          `SELECT hotel_id FROM hotel_assignment_dispatch_locks WHERE hotel_id = ? FOR UPDATE`,
          [campaign.hotelId],
        );
      }

      const activeList = await em.find(PromotionCampaign, {
        where: {
          hotelId: campaign.hotelId,
          status: In([PromotionCampaignStatus.APPROVED, PromotionCampaignStatus.SCHEDULED, PromotionCampaignStatus.ACTIVE]),
        },
      });
      const conflicts = detectCampaignConflicts(campaign, activeList);
      if (conflicts.length > 0) {
        throw new ConflictException(
          `Chặn kích hoạt do xung đột giảm giá chồng lấn: ${conflicts.map((c) => c.reason).join('; ')}`,
        );
      }

      const now = new Date();
      campaign.status = PromotionCampaignStatus.ACTIVE;
      campaign.approvedBy = actor.id;
      campaign.approvedAt = now;
      campaign.publishedAt = now;
      const savedCampaign = await em.save(PromotionCampaign, campaign);

      if (savedCampaign.existingBookingsEligible && this.outboxService) {
        await this.outboxService.addEvent(
          em,
          'promotion.retroactive_scan_requested',
          'PromotionCampaign',
          String(savedCampaign.id),
          {
            campaignId: savedCampaign.id,
            hotelId: savedCampaign.hotelId,
            version: savedCampaign.version,
            actorId: actor.id,
          },
        );
      }

      return savedCampaign;
    });

    if (result.existingBookingsEligible) {
      await this.evaluateExistingBookingsForHotel(result.hotelId, actor, 50);
    }
    return result;
  }

  async pauseCampaign(actor: { id: string; role: string }, campaignId: string, reason?: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException(`Không tìm thấy chiến dịch #${campaignId}`);
    await this.assertHotelManager(actor, campaign.hotelId);
    campaign.status = PromotionCampaignStatus.PAUSED;
    campaign.pausedReason = reason || 'Quản lý tạm dừng cấp mới';
    return await this.campaignRepo.save(campaign);
  }

  async getHotelCampaigns(hotelId: string, actor?: { id: string; role: string }) {
    if (!actor || actor.role === 'CUSTOMER') {
      throw new ForbiddenException('Khách hàng không được truy cập danh sách chiến dịch nội bộ. Vui lòng dùng endpoint public /hotels/:hotelId/active.');
    }
    if (actor.role === 'EMPLOYEE') {
      if (!(await this.staffAvailabilityService.isStaffAtHotel(actor.id, hotelId))) {
        throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn này.');
      }
    }
    return await this.campaignRepo.find({
      where: { hotelId },
      order: { createdAt: 'DESC' },
    });
  }

  async calculateAndSaveQuote(dto: CalculateQuoteDto, actor?: { id: string; role: string }) {
    const room = await this.roomRepo.findOne({ where: { id: dto.roomId } });
    if (!room) throw new NotFoundException(`Không tìm thấy phòng #${dto.roomId}`);
    const activeCampaigns = await this.campaignRepo.find({
      where: { hotelId: String(room.hotelId), status: PromotionCampaignStatus.ACTIVE },
    });
    const computed = computeNightlyQuote({
      hotelId: String(room.hotelId),
      roomId: String(room.id),
      baseRatePerNight: Number(room.pricePerNight),
      roomQuantity: dto.roomCount ?? 1,
      totalGuests: dto.totalGuests ?? 2,
      checkInAt: dto.checkInAt,
      checkOutAt: dto.checkOutAt,
      activeCampaigns,
    });
    const quote = this.quoteRepo.create({
      quoteCode: `QT-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      hotelId: String(room.hotelId),
      userId: actor?.id || null,
      roomId: String(room.id),
      roomQuantity: dto.roomCount ?? 1,
      totalGuests: dto.totalGuests ?? 2,
      checkInLocalDate: computed.checkInLocalDate,
      checkOutLocalDate: computed.checkOutLocalDate,
      nightsCount: computed.nightsCount,
      baseTotal: computed.baseTotal,
      discountTotal: computed.discountTotal,
      payableTotal: computed.payableTotal,
      currency: 'VND',
      hotelTimezone: 'Asia/Ho_Chi_Minh',
      priceHash: computed.priceHash,
      nightlyLines: computed.nightlyLines,
      appliedCampaigns: computed.appliedCampaigns,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      version: 1,
    });
    return await this.quoteRepo.save(quote);
  }

  async getQuoteById(quoteId: string, actor?: { id: string; role: string }) {
    const quote = await this.quoteRepo.findOne({
      where: [{ id: quoteId }, { quoteCode: quoteId }],
    });
    if (!quote) throw new NotFoundException(`Không tìm thấy báo giá #${quoteId}`);
    // PP-P0-06 / PIT-07: Enforce quote ownership & hotel staff access
    if (actor && actor.role !== 'ADMIN') {
      if (actor.role === 'CUSTOMER') {
        if (!quote.userId || String(quote.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn không có quyền đọc báo giá của khách hàng khác.');
        }
      } else if (actor.role === 'EMPLOYEE') {
        if (!(await this.staffAvailabilityService.isStaffAtHotel(actor.id, quote.hotelId))) {
          throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn của báo giá này.');
        }
      }
    }
    return quote;
  }

  async getPublicActiveCampaigns(hotelId: string) {
    const list = await this.campaignRepo.find({
      where: { hotelId, status: PromotionCampaignStatus.ACTIVE },
      order: { stayStartDate: 'ASC' },
    });
    return list.map((c) => ({
      id: c.id,
      hotelId: c.hotelId,
      code: c.code,
      name: c.name,
      description: c.description,
      campaignType: c.campaignType,
      targetScope: c.targetScope,
      targetRoomIds: c.targetRoomIds,
      stayStartDate: c.stayStartDate,
      stayEndExclusiveDate: c.stayEndExclusiveDate,
      discountType: c.discountType,
      discountValue: c.discountValue,
      minNights: c.minNights,
      minRooms: c.minRooms,
      minGuests: c.minGuests,
      benefitKind: c.benefitKind,
    }));
  }

  async previewCampaign(actor: { id: string; role: string }, campaignId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException(`Không tìm thấy chiến dịch #${campaignId}`);
    await this.assertHotelManager(actor, campaign.hotelId);
    const activeList = await this.campaignRepo.find({
      where: {
        hotelId: campaign.hotelId,
        status: In([PromotionCampaignStatus.APPROVED, PromotionCampaignStatus.SCHEDULED, PromotionCampaignStatus.ACTIVE]),
      },
    });
    const conflicts = detectCampaignConflicts(campaign, activeList);
    return {
      campaign,
      canPublish: conflicts.length === 0,
      conflicts,
    };
  }

  async quoteServiceItem(params: {
    hotelId: string;
    serviceId: string;
    baseUnitPrice: number;
    quantity?: number;
    usageAt?: Date | string;
  }) {
    const activeCampaigns = await this.campaignRepo.find({
      where: { hotelId: String(params.hotelId), status: PromotionCampaignStatus.ACTIVE },
    });
    const pricing = computeServiceItemPricing({
      hotelId: String(params.hotelId),
      serviceId: String(params.serviceId),
      baseUnitPrice: Number(params.baseUnitPrice || 0),
      quantity: Number(params.quantity || 1),
      usageAt: params.usageAt || new Date(),
      activeCampaigns,
    });
    return {
      grossTotal: pricing.grossTotal,
      discountAmount: pricing.discountAmount,
      netTotal: pricing.netTotal,
      campaignId: pricing.appliedCampaign ? String(pricing.appliedCampaign.id) : null,
      campaignCode: pricing.appliedCampaign ? pricing.appliedCampaign.code : null,
      campaignVersion: pricing.appliedCampaign ? pricing.appliedCampaign.version : null,
    };
  }

  async getHotelReconciliationReport(actor: { id: string; role: string }, hotelId: string) {
    await this.assertHotelManager(actor, hotelId);
    const [accounts, ledger, campaigns] = await Promise.all([
      this.accountRepo.find({ where: { hotelId } }),
      this.ledgerRepo.find({ where: { hotelId } }),
      this.campaignRepo.find({ where: { hotelId } }),
    ]);
    let refundIntents: PromotionRefundIntent[] = [];
    try {
      refundIntents = await this.dataSource.getRepository(PromotionRefundIntent).find({ where: { hotelId } });
    } catch {
      refundIntents = [];
    }

    const ledgerByAcc = new Map<string, BookingBenefitLedger[]>();
    for (const entry of ledger) {
      const key = String(entry.accountId);
      const arr = ledgerByAcc.get(key) || [];
      arr.push(entry);
      ledgerByAcc.set(key, arr);
    }

    const discrepancies: Array<{ accountId: string; bookingId: string; materialized: number; ledgerSum: number }> = [];
    for (const acc of accounts) {
      const sum = (ledgerByAcc.get(String(acc.id)) || []).reduce((s, e) => s + Number(e.amountDelta || 0), 0);
      if (Math.round(sum) !== Math.round(Number(acc.availableAmount || 0))) {
        discrepancies.push({
          accountId: acc.id,
          bookingId: acc.bookingId,
          materialized: Number(acc.availableAmount || 0),
          ledgerSum: sum,
        });
      }
    }

    const pendingStatuses: string[] = [
      RefundIntentStatus.REQUESTED,
      RefundIntentStatus.PROCESSING,
      RefundIntentStatus.UNKNOWN_RECONCILE,
    ];

    return {
      hotelId,
      totalAccounts: accounts.length,
      totalLedgerEntries: ledger.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
      financialSummary: {
        totalGranted: accounts.reduce((s, a) => s + Number(a.grantedAmount || 0), 0),
        totalRedeemed: accounts.reduce((s, a) => s + Number(a.redeemedAmount || 0), 0),
        totalRefunded: accounts.reduce((s, a) => s + Number(a.refundedAmount || 0), 0),
        totalAvailableLiability: accounts
          .filter((a) => a.status === BenefitAccountStatus.APPROVED || a.status === BenefitAccountStatus.REFUND_PENDING)
          .reduce((s, a) => s + Number(a.availableAmount || 0), 0),
        pendingRefundIntentsCount: refundIntents.filter((i) => pendingStatuses.includes(i.status)).length,
        succeededRefundIntentsAmount: refundIntents
          .filter((i) => i.status === RefundIntentStatus.SUCCEEDED)
          .reduce((s, i) => s + Number(i.amount || 0), 0),
        campaignsBudgetReserved: campaigns.reduce((s, c) => s + Number(c.budgetReserved || 0), 0),
        campaignsBudgetConsumed: campaigns.reduce((s, c) => s + Number(c.budgetConsumed || 0), 0),
      },
    };
  }

  async evaluateExistingBookingsForHotel(
    hotelId: string,
    actor?: { id: string; role: string },
    batchSize = 50,
    afterBookingId = '0',
  ) {
    if (actor) await this.assertHotelManager(actor, hotelId);
    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .where('b.hotel_id = :hotelId', { hotelId })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.NO_SHOW,
        ],
      })
      .andWhere('b.id > :afterBookingId', { afterBookingId })
      .orderBy('b.id', 'ASC')
      .take(Math.max(1, Math.min(200, batchSize)))
      .getMany();

    const granted: BookingBenefitAccount[] = [];
    const failedBookingIds: string[] = [];
    for (const b of bookings) {
      try {
        const res = await this.evaluateExistingBookingBenefits(b.id, actor);
        granted.push(...res);
      } catch {
        failedBookingIds.push(String(b.id));
      }
    }
    return {
      evaluatedBookings: bookings.length,
      grantedCount: granted.length,
      granted,
      failedBookingIds,
      nextCursor: bookings.length > 0 ? String(bookings[bookings.length - 1].id) : afterBookingId,
      hasMore: bookings.length >= batchSize,
    };
  }

  async evaluateExistingBookingBenefits(bookingId: string, actor?: { id: string; role: string }) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      if (![BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.NO_SHOW].includes(booking.status as BookingStatus)) {
        return [];
      }

      const bookingRooms = await em.find(BookingRoom, { where: { bookingId: booking.id } });
      if (!bookingRooms.length) return [];

      // PP-P0-07 / PIT-12: Check confirmed checkout quote & existing GRANT ledger so nights already discounted at checkout are never double-granted
      const confirmedQuotes = await em.find(BookingPriceQuote, {
        where: { bookingId: booking.id, status: 'CONFIRMED' },
      });
      const alreadyDiscountedRoomNights = new Set<string>();
      const alreadyAppliedCheckoutCampaigns = new Set<string>();
      for (const cq of confirmedQuotes) {
        for (const nl of cq.nightlyLines || []) {
          if (Number(nl.discountAmount || 0) > 0 && nl.appliedCampaignId) {
            alreadyDiscountedRoomNights.add(`${nl.roomId}:${nl.nightDate}`);
            alreadyAppliedCheckoutCampaigns.add(`${nl.roomId}:${nl.appliedCampaignId}`);
          }
        }
      }

      const priorGrantLedgers = await em.find(BookingBenefitLedger, {
        where: { bookingId: booking.id, entryType: BenefitLedgerEntryType.GRANT },
      });
      for (const gl of priorGrantLedgers) {
        const nightsMeta = (gl.metadata as any)?.discountedNights;
        const rId = (gl.metadata as any)?.roomId;
        if (rId && Array.isArray(nightsMeta)) {
          for (const nm of nightsMeta) {
            if (nm?.nightDate && Number(nm?.discountAmount || 0) > 0) {
              alreadyDiscountedRoomNights.add(`${rId}:${nm.nightDate}`);
            }
          }
        }
      }

      const activeCampaigns = await em.find(PromotionCampaign, {
        where: { hotelId: String(booking.hotelId), status: PromotionCampaignStatus.ACTIVE },
      });
      const createdAccounts: BookingBenefitAccount[] = [];
      const sharedCampaignUsedTotals = new Map<string, number>();

      for (const br of bookingRooms) {
        const room = await em.findOne(Room, { where: { id: br.roomId } });
        const baseRate = Number(br.pricePerNight || room?.pricePerNight || 0);
        const qty = Number(br.quantity || booking.requestedRoomCount || 1);
        const expectedUndiscounted = baseRate * Number(br.nights || 1) * qty;
        const alreadyDiscountedWithoutQuote =
          confirmedQuotes.length === 0 &&
          expectedUndiscounted > 0 &&
          Math.round(Number(br.subtotal || 0)) < Math.round(expectedUndiscounted);

        const quote = computeNightlyQuote({
          hotelId: String(booking.hotelId),
          roomId: String(br.roomId),
          baseRatePerNight: baseRate,
          roomQuantity: qty,
          totalGuests: Number(booking.totalGuests || 1),
          checkInAt: booking.checkInAt,
          checkOutAt: booking.checkOutAt,
          activeCampaigns,
          forExistingBooking: true,
          sharedCampaignUsedTotals,
        });

        for (const applied of quote.appliedCampaigns) {
          const camp = await em.findOne(PromotionCampaign, {
            where: { id: applied.campaignId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!camp || camp.status !== PromotionCampaignStatus.ACTIVE) continue;
          if (alreadyAppliedCheckoutCampaigns.has(`${br.roomId}:${camp.id}`)) continue;
          if (alreadyDiscountedWithoutQuote && camp.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT) continue;

          const todayLocal = toLocalHotelDate(new Date(), camp.hotelTimezone || 'Asia/Ho_Chi_Minh');
          const eligibleNights = quote.nightlyLines.filter((l) => {
            if (String(l.appliedCampaignId) !== String(camp.id)) return false;
            if (!camp.retroactiveMode && l.nightDate < todayLocal) return false;
            if (alreadyDiscountedRoomNights.has(`${br.roomId}:${l.nightDate}`)) return false;
            return l.discountAmount > 0;
          });

          const effectiveDiscountAmount = eligibleNights.reduce((s, l) => s + Number(l.discountAmount || 0), 0);
          const totalQuota = (camp.packageConfig?.includedQuotas || []).reduce(
            (s, q) => s + Number(q.quantity || 0),
            0,
          );
          const hasStayOverlapForQuota =
            totalQuota > 0 &&
            quote.nightlyLines.some(
              (l) =>
                l.nightDate >= camp.stayStartDate &&
                l.nightDate < camp.stayEndExclusiveDate &&
                (camp.retroactiveMode || l.nightDate >= todayLocal),
            );

          if (effectiveDiscountAmount <= 0 && !hasStayOverlapForQuota) continue;

          if (effectiveDiscountAmount > 0 && !hasRemainingCampaignBudget(camp, effectiveDiscountAmount)) {
            if (camp.budgetTotal !== null) {
              camp.status = PromotionCampaignStatus.EXHAUSTED;
              await em.save(PromotionCampaign, camp);
            }
            continue;
          }

          const dedupeKey = `booking:${booking.id}:room:${br.roomId}:camp:${camp.id}:v:${camp.version}`;
          const existingAcc = await em.findOne(BookingBenefitAccount, { where: { dedupeKey } });
          if (existingAcc) continue;

          const quotaServiceCodes = (camp.packageConfig?.includedQuotas || [])
            .map((q) => String(q.serviceCode || ''))
            .filter(Boolean);
          const allowedServices =
            camp.targetServiceIds && camp.targetServiceIds.length > 0
              ? camp.targetServiceIds
              : quotaServiceCodes.length > 0
              ? quotaServiceCodes
              : null;

          const account = await em.save(
            BookingBenefitAccount,
            em.create(BookingBenefitAccount, {
              bookingId: booking.id,
              hotelId: String(booking.hotelId),
              campaignId: camp.id,
              benefitKind: camp.benefitKind,
              sourceType: 'CAMPAIGN_RETROACTIVE',
              status: BenefitAccountStatus.APPROVED,
              currency: 'VND',
              grantedAmount: effectiveDiscountAmount,
              redeemedAmount: 0,
              reversedAmount: 0,
              refundedAmount: 0,
              availableAmount: effectiveDiscountAmount,
              grantedQuota: totalQuota,
              usedQuota: 0,
              availableQuota: totalQuota,
              allowedServiceIds: allowedServices,
              customerAcceptedCredit: camp.benefitKind !== BenefitKind.ROOM_PRICE_ADJUSTMENT,
              expiresAt: camp.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT ? null : new Date(booking.checkOutAt),
              dedupeKey,
              approvedBy: actor?.id || camp.approvedBy || null,
              approvedAt: new Date(),
              note: `Quyền lợi từ chiến dịch ${camp.name} (${camp.code}) cho ${eligibleNights.length || quote.nightsCount} đêm`,
              version: 1,
            }),
          );

          await em.save(
            BookingBenefitLedger,
            em.create(BookingBenefitLedger, {
              accountId: account.id,
              bookingId: booking.id,
              hotelId: String(booking.hotelId),
              campaignId: camp.id,
              entryType: BenefitLedgerEntryType.GRANT,
              amountDelta: effectiveDiscountAmount,
              balanceAfter: effectiveDiscountAmount,
              quotaDelta: totalQuota,
              quotaAfter: totalQuota,
              performedBy: actor?.id || null,
              idempotencyKey: `grant:${dedupeKey}`,
              reason: `Cấp quyền lợi ${camp.benefitKind} (${effectiveDiscountAmount.toLocaleString('vi-VN')}đ${totalQuota > 0 ? ` +${totalQuota} suất` : ''})`,
              metadata: {
                roomId: String(br.roomId),
                discountedNights: eligibleNights.map((d) => ({
                  nightDate: d.nightDate,
                  discountAmount: d.discountAmount,
                })),
                includedQuotas: camp.packageConfig?.includedQuotas || [],
              },
            }),
          );

          for (const en of eligibleNights) {
            alreadyDiscountedRoomNights.add(`${br.roomId}:${en.nightDate}`);
          }

          camp.budgetReserved = Number(camp.budgetReserved || 0) + effectiveDiscountAmount;
          camp.redemptionsCount = Number(camp.redemptionsCount || 0) + 1;
          await em.save(PromotionCampaign, camp);
          createdAccounts.push(account);
        }
      }
      return createdAccounts;
    });
  }

  async acceptRoomAdjustmentAsCredit(
    bookingId: string,
    accountId: string,
    actor: { id: string; role: string },
    dto?: AcceptConsentDto,
  ) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId } });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      let consentChannel = dto?.channel || 'CUSTOMER_APP';
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn chỉ có thể xác nhận phương án cấn trừ cho đơn của chính mình.');
        }
      } else {
        await assertBookingOperator(em, booking, actor);
        if (!dto?.evidenceRef || !dto.evidenceRef.trim()) {
          throw new ForbiddenException(
            'Nhân viên lễ tân không được tự xác nhận đồng ý cấn trừ thay khách hàng khi chưa có chứng cứ biên bản/OTP (evidenceRef).',
          );
        }
        consentChannel = dto.channel || 'COUNTER_SIGNED_EVIDENCE';
      }

      const acc = await em.findOne(BookingBenefitAccount, {
        where: { id: accountId, bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${accountId}`);
      acc.customerAcceptedCredit = true;
      acc.version += 1;
      const savedAcc = await em.save(BookingBenefitAccount, acc);
      try {
        await em.save(
          BenefitConsentRecord,
          em.create(BenefitConsentRecord, {
            accountId: acc.id,
            bookingId: booking.id,
            hotelId: String(booking.hotelId),
            guestUserId: String(booking.userId),
            channel: consentChannel,
            termsVersion: dto?.termsVersion || 'v1.0',
            evidenceRef: dto?.evidenceRef || `GUEST_ONLINE_CONSENT:${actor.id}`,
          }),
        );
      } catch {}
      return savedAcc;
    });
  }

  async redeemBenefitForService(actor: { id: string; role: string }, dto: RedeemBenefitDto & { customerAgreedToOffset?: boolean }) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: dto.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);

      await assertBookingOperator(em, booking, actor, 'SERVICE_REQUEST');

      const payloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            bookingId: String(dto.bookingId),
            serviceRequestId: String(dto.serviceRequestId || ''),
            requestedAmount: Number(dto.requestedAmount || 0),
            requestedQuota: Number(dto.requestedQuota || 0),
            serviceId: String(dto.serviceId || ''),
          }),
        )
        .digest('hex');

      const existingEntries = await em.find(BookingBenefitLedger, {
        where: { bookingId: booking.id },
      });
      const matched = existingEntries.filter(
        (e) =>
          e.idempotencyKey === dto.idempotencyKey ||
          e.idempotencyKey.startsWith(`${dto.idempotencyKey}:acc:`),
      );
      if (matched.length > 0) {
        const storedMeta = (matched[0].metadata || {}) as any;
        if (storedMeta.payloadHash && storedMeta.payloadHash !== payloadHash) {
          throw new ConflictException(
            'IDEMPOTENCY_KEY_REUSED: Mã idempotencyKey đã được sử dụng cho một lệnh cấn trừ có thông số khác.',
          );
        }
        return {
          serviceRequestId: matched[0].serviceRequestId,
          redeemedAmount: matched.reduce((s, e) => s + Math.abs(Number(e.amountDelta)), 0),
          redeemedQuota: matched.reduce((s, e) => s + Math.abs(Number(e.quotaDelta)), 0),
          remainingServicePayable:
            storedMeta.remainingServicePayable !== undefined ? Number(storedMeta.remainingServicePayable) : 0,
          isIdempotentRepeat: true,
        };
      }

      if (!dto.serviceRequestId || !String(dto.serviceRequestId).trim()) {
        throw new BadRequestException('Bắt buộc chỉ định mã yêu cầu dịch vụ (serviceRequestId) để cấn trừ.');
      }

      const serviceReq = await em.findOne(ServiceRequest, {
        where: { id: Number(dto.serviceRequestId) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!serviceReq) {
        throw new NotFoundException(`Không tìm thấy phiếu yêu cầu dịch vụ #${dto.serviceRequestId} để cấn trừ.`);
      }
      if (String(serviceReq.bookingId) !== String(booking.id)) {
        throw new ForbiddenException(`Phiếu yêu cầu dịch vụ #${dto.serviceRequestId} không thuộc đơn đặt phòng #${booking.id}.`);
      }
      if (serviceReq.status === 'CANCELLED' || serviceReq.status === 'FAILED') {
        throw new ConflictException(`Không thể cấn trừ cho phiếu dịch vụ #${dto.serviceRequestId} đang ở trạng thái ${serviceReq.status}.`);
      }

      const serviceNet = Math.max(0, Math.round(Number(serviceReq.totalPrice || 0)));
      const priorServiceEntries = existingEntries.filter((e) => String(e.serviceRequestId) === String(dto.serviceRequestId));
      const alreadyAllocatedAmount = priorServiceEntries.reduce((sum, e) => {
        if (e.entryType === BenefitLedgerEntryType.REDEEM) return sum + Math.abs(Math.round(Number(e.amountDelta || 0)));
        if (e.entryType === BenefitLedgerEntryType.REVERSAL) return sum - Math.abs(Math.round(Number(e.amountDelta || 0)));
        return sum;
      }, 0);

      const actualOutstanding = Math.max(0, serviceNet - Math.max(0, alreadyAllocatedAmount));
      const reqQuota = Math.max(0, Math.round(Number(dto.requestedQuota || 0)));
      if (actualOutstanding <= 0 && reqQuota <= 0) {
        throw new ConflictException(`Phiếu dịch vụ #${dto.serviceRequestId} đã được cấn trừ đủ, không còn số dư phải thu.`);
      }

      const requestedAmt =
        dto.requestedAmount !== undefined && Number(dto.requestedAmount) > 0
          ? Math.min(Math.round(Number(dto.requestedAmount)), actualOutstanding)
          : actualOutstanding;

      const accounts = await em
        .getRepository(BookingBenefitAccount)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where("a.booking_id = :bookingId AND a.status = 'APPROVED'", { bookingId: booking.id })
        .orderBy('a.id', 'ASC')
        .getMany();

      let remainingToRedeem = requestedAmt;
      let remainingQuotaToRedeem = reqQuota;
      let totalRedeemedAmount = 0;
      let totalRedeemedQuota = 0;
      const effectiveServiceKey = String(dto.serviceId || serviceReq.serviceId || '');
      const stagedLedgers: Array<{ acc: BookingBenefitAccount; useAmt: number; useQ: number }> = [];

      for (const acc of accounts) {
        if (acc.expiresAt && new Date(acc.expiresAt) <= new Date()) continue;
        if (
          effectiveServiceKey &&
          Array.isArray(acc.allowedServiceIds) &&
          acc.allowedServiceIds.length > 0 &&
          !acc.allowedServiceIds.map(String).includes(effectiveServiceKey) &&
          !(dto.serviceId && acc.allowedServiceIds.map(String).includes(String(dto.serviceId)))
        ) {
          continue;
        }
        if (acc.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT && !acc.customerAcceptedCredit) {
          throw new ConflictException(
            'Khoản giảm giá phòng (ROOM_PRICE_ADJUSTMENT) là tiền phải hoàn; cần khách hàng xác nhận đồng ý cấn trừ dịch vụ trước khi trừ.',
          );
        }

        const availAmt = Math.max(0, Math.round(Number(acc.availableAmount || 0)));
        const availQ = Math.max(0, Math.round(Number(acc.availableQuota || 0)));
        const useAmt = Math.min(remainingToRedeem, availAmt);
        const useQ = Math.min(remainingQuotaToRedeem, availQ);
        if (useAmt <= 0 && useQ <= 0) continue;

        acc.redeemedAmount = Number(acc.redeemedAmount || 0) + useAmt;
        acc.availableAmount = availAmt - useAmt;
        acc.usedQuota = Number(acc.usedQuota || 0) + useQ;
        acc.availableQuota = availQ - useQ;
        acc.version += 1;
        await em.save(BookingBenefitAccount, acc);

        stagedLedgers.push({ acc, useAmt, useQ });
        remainingToRedeem -= useAmt;
        remainingQuotaToRedeem -= useQ;
        totalRedeemedAmount += useAmt;
        totalRedeemedQuota += useQ;
        if (remainingToRedeem === 0 && remainingQuotaToRedeem === 0) break;
      }

      if (totalRedeemedAmount === 0 && totalRedeemedQuota === 0) {
        throw new ConflictException('Không còn số dư quyền lợi hoặc quota hợp lệ để cấn trừ.');
      }

      const finalRemainingServicePayable = Math.max(0, actualOutstanding - totalRedeemedAmount);

      for (const item of stagedLedgers) {
        await em.save(
          BookingBenefitLedger,
          em.create(BookingBenefitLedger, {
            accountId: item.acc.id,
            bookingId: booking.id,
            hotelId: String(booking.hotelId),
            campaignId: item.acc.campaignId,
            entryType: BenefitLedgerEntryType.REDEEM,
            amountDelta: -item.useAmt,
            balanceAfter: item.acc.availableAmount,
            quotaDelta: -item.useQ,
            quotaAfter: item.acc.availableQuota,
            serviceRequestId: String(dto.serviceRequestId),
            performedBy: actor.id,
            idempotencyKey: `${dto.idempotencyKey}:acc:${item.acc.id}`,
            reason: dto.reason || `Cấn trừ dịch vụ #${dto.serviceRequestId} (${serviceReq.serviceName})`,
            metadata: {
              payloadHash,
              serviceGross: serviceNet,
              serviceNet,
              previouslyAllocated: alreadyAllocatedAmount,
              remainingServicePayable: finalRemainingServicePayable,
            },
          }),
        );
      }

      return {
        serviceRequestId: String(dto.serviceRequestId),
        serviceGross: serviceNet,
        serviceNet,
        redeemedAmount: totalRedeemedAmount,
        redeemedQuota: totalRedeemedQuota,
        remainingServicePayable: finalRemainingServicePayable,
        isIdempotentRepeat: false,
      };
    });
  }

  async reverseServiceRedemption(
    actor: { id: string; role: string },
    bookingId: string,
    serviceRequestId: string,
    reason?: string,
  ) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      await assertBookingOperator(em, booking, actor, 'SERVICE_REQUEST');

      const serviceReq = await em.findOne(ServiceRequest, { where: { id: Number(serviceRequestId) } });
      if (serviceReq && String(serviceReq.bookingId) !== String(booking.id)) {
        throw new ForbiddenException(`Phiếu dịch vụ #${serviceRequestId} không thuộc đơn đặt phòng #${booking.id}.`);
      }

      const redeems = await em.find(BookingBenefitLedger, {
        where: { bookingId, serviceRequestId, entryType: BenefitLedgerEntryType.REDEEM },
      });
      if (!redeems.length) {
        return { reversedAmount: 0, reversedQuota: 0 };
      }

      let reversedAmount = 0;
      let reversedQuota = 0;
      for (const red of redeems) {
        const revKey = `reversal:ledger:${red.id}`;
        const existingRev = await em.findOne(BookingBenefitLedger, { where: { idempotencyKey: revKey } });
        if (existingRev) continue;

        const acc = await em.findOne(BookingBenefitAccount, {
          where: { id: red.accountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!acc) continue;

        const restoreAmt = Math.abs(Math.round(Number(red.amountDelta || 0)));
        const restoreQ = Math.abs(Math.round(Number(red.quotaDelta || 0)));
        acc.reversedAmount = Number(acc.reversedAmount || 0) + restoreAmt;
        acc.redeemedAmount = Math.max(0, Number(acc.redeemedAmount || 0) - restoreAmt);
        acc.availableAmount = Number(acc.availableAmount || 0) + restoreAmt;
        acc.usedQuota = Math.max(0, Number(acc.usedQuota || 0) - restoreQ);
        acc.availableQuota = Number(acc.availableQuota || 0) + restoreQ;
        if (acc.status === BenefitAccountStatus.SETTLED && (acc.availableAmount > 0 || acc.availableQuota > 0)) {
          acc.status = BenefitAccountStatus.APPROVED;
        }
        acc.version += 1;
        await em.save(BookingBenefitAccount, acc);

        await em.save(
          BookingBenefitLedger,
          em.create(BookingBenefitLedger, {
            accountId: acc.id,
            bookingId,
            hotelId: String(booking.hotelId),
            campaignId: acc.campaignId,
            entryType: BenefitLedgerEntryType.REVERSAL,
            amountDelta: restoreAmt,
            balanceAfter: acc.availableAmount,
            quotaDelta: restoreQ,
            quotaAfter: acc.availableQuota,
            serviceRequestId,
            referenceEntryId: red.id,
            performedBy: actor.id,
            idempotencyKey: revKey,
            reason: reason || `Đảo giao dịch do hủy dịch vụ #${serviceRequestId}`,
          }),
        );

        reversedAmount += restoreAmt;
        reversedQuota += restoreQ;
      }
      return { reversedAmount, reversedQuota };
    });
  }

  async settleRemainingRefundAtCheckout(
    actor: { id: string; role: string },
    bookingId: string,
    accountId: string,
    idempotencyKey: string,
    reason?: string,
    options?: SettleRefundDto & { simulateProviderTimeout?: boolean },
  ) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      await this.assertHotelManager(actor, String(booking.hotelId));

      const acc = await em.findOne(BookingBenefitAccount, {
        where: { id: accountId, bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${accountId}`);
      if (acc.benefitKind !== BenefitKind.ROOM_PRICE_ADJUSTMENT) {
        throw new BadRequestException('Chỉ khoản giảm giá phòng (ROOM_PRICE_ADJUSTMENT) mới được tất toán hoàn tiền.');
      }

      const existingLedger = await em.findOne(BookingBenefitLedger, { where: { idempotencyKey } });
      if (existingLedger) {
        return {
          settledRefundAmount: Math.abs(Math.round(Number(existingLedger.amountDelta || 0))),
          status: 'SUCCEEDED',
          account: acc,
          isIdempotentRepeat: true,
        };
      }

      try {
        const existingIntent = await em.findOne(PromotionRefundIntent, { where: { idempotencyKey } });
        if (existingIntent) {
          return {
            settledRefundAmount: existingIntent.status === RefundIntentStatus.SUCCEEDED ? Number(existingIntent.amount) : 0,
            reservedRefundAmount: Number(existingIntent.amount),
            status: existingIntent.status,
            refundIntent: existingIntent,
            account: acc,
            isIdempotentRepeat: true,
          };
        }
      } catch {}

      const refundAmt = Math.max(0, Math.round(Number(acc.availableAmount || 0)));
      if (refundAmt <= 0) return { settledRefundAmount: 0, status: acc.status, account: acc };

      const payment = await em.findOne(PaymentTransaction, {
        where: { bookingId: booking.id, status: PaymentTransactionStatus.PAID },
        lock: { mode: 'pessimistic_write' },
      });
      if (payment) {
        const maxRefundable = Math.max(0, Math.round(Number(payment.amount || 0) - Number(payment.refundAmount || 0)));
        if (refundAmt > maxRefundable) {
          throw new ConflictException(`Số tiền hoàn (${refundAmt}đ) vượt quá số thực thu còn có thể hoàn (${maxRefundable}đ).`);
        }
      }

      const channel = options?.channel || 'VNPAY_PROVIDER';
      if (options?.simulateProviderTimeout || (channel === 'VNPAY_PROVIDER' && options?.payoutReceiptRef === 'ASYNC_GATEWAY_PENDING')) {
        acc.status = BenefitAccountStatus.REFUND_PENDING;
        acc.version += 1;
        await em.save(BookingBenefitAccount, acc);
        let savedIntent: PromotionRefundIntent | null = null;
        try {
          savedIntent = await em.save(
            PromotionRefundIntent,
            em.create(PromotionRefundIntent, {
              bookingId,
              hotelId: String(booking.hotelId),
              accountId: acc.id,
              paymentId: payment?.id || null,
              amount: refundAmt,
              channel,
              status: options?.simulateProviderTimeout ? RefundIntentStatus.UNKNOWN_RECONCILE : RefundIntentStatus.REQUESTED,
              idempotencyKey,
              requestedBy: actor.id,
              reason: reason || 'Yêu cầu hoàn tiền chênh lệch giảm giá phòng',
            }),
          );
        } catch {}
        if (this.outboxService && payment) {
          await this.outboxService.addEvent(em, 'promotion.refund.requested', 'BookingBenefitAccount', String(acc.id), {
            intentId: savedIntent?.id,
            bookingId,
            accountId: acc.id,
            paymentId: payment.id,
            txnRef: payment.txnRef,
            amount: refundAmt,
            idempotencyKey,
            reason,
          });
        }
        return {
          settledRefundAmount: 0,
          reservedRefundAmount: refundAmt,
          status: savedIntent?.status || RefundIntentStatus.UNKNOWN_RECONCILE,
          refundIntent: savedIntent,
          account: acc,
        };
      }

      if ((channel === 'BANK_TRANSFER_PROOF' || channel === 'CASH_RECEIPT') && (!options?.payoutReceiptRef || !options.payoutReceiptRef.trim())) {
        throw new BadRequestException('Hoàn tiền qua chuyển khoản/tiền mặt bắt buộc có mã chứng từ chi (payoutReceiptRef).');
      }

      if (payment) {
        const nextRefund = Number(payment.refundAmount || 0) + refundAmt;
        payment.refundAmount = nextRefund.toFixed(2);
        payment.refundedAt = new Date();
        if (nextRefund >= Number(payment.amount || 0)) payment.status = PaymentTransactionStatus.REFUNDED;
        await em.save(PaymentTransaction, payment);
      }

      acc.refundedAmount = Number(acc.refundedAmount || 0) + refundAmt;
      acc.availableAmount = 0;
      acc.status = BenefitAccountStatus.SETTLED;
      acc.version += 1;
      await em.save(BookingBenefitAccount, acc);

      await em.save(
        BookingBenefitLedger,
        em.create(BookingBenefitLedger, {
          accountId: acc.id,
          bookingId,
          hotelId: String(booking.hotelId),
          campaignId: acc.campaignId,
          entryType: BenefitLedgerEntryType.REFUND_SETTLEMENT,
          amountDelta: -refundAmt,
          balanceAfter: 0,
          quotaDelta: 0,
          quotaAfter: acc.availableQuota,
          performedBy: actor.id,
          idempotencyKey,
          reason: reason || `Tất toán hoàn trả tiền chênh lệch giảm giá phòng (${refundAmt.toLocaleString('vi-VN')}đ)`,
        }),
      );

      return { settledRefundAmount: refundAmt, status: 'SUCCEEDED', account: acc };
    });
  }

  async confirmRefundIntentSettlement(
    actor: { id: string; role: string },
    intentId: string,
    payload: { providerRef?: string; payoutReceiptRef?: string },
  ) {
    return await this.dataSource.transaction(async (em) => {
      const intent = await em.findOne(PromotionRefundIntent, {
        where: { id: intentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intent) throw new NotFoundException(`Không tìm thấy yêu cầu hoàn tiền #${intentId}`);
      await this.assertHotelManager(actor, String(intent.hotelId));
      if (intent.status === RefundIntentStatus.SUCCEEDED) {
        return { settledRefundAmount: Number(intent.amount), status: intent.status, refundIntent: intent };
      }
      const acc = await em.findOne(BookingBenefitAccount, {
        where: { id: intent.accountId, bookingId: intent.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${intent.accountId}`);

      const refundAmt = Math.max(0, Math.round(Number(intent.amount || acc.availableAmount || 0)));
      intent.status = RefundIntentStatus.SUCCEEDED;
      intent.providerRef = payload?.providerRef || intent.providerRef || `VNP-CONFIRMED-${intent.id}`;
      intent.payoutReceiptRef = payload?.payoutReceiptRef || intent.payoutReceiptRef || `RECEIPT-${intent.id}`;
      intent.verifiedBy = actor.id;
      await em.save(PromotionRefundIntent, intent);

      acc.refundedAmount = Number(acc.refundedAmount || 0) + refundAmt;
      acc.availableAmount = Math.max(0, Number(acc.availableAmount || 0) - refundAmt);
      acc.status = acc.availableAmount === 0 ? BenefitAccountStatus.SETTLED : BenefitAccountStatus.APPROVED;
      acc.version += 1;
      await em.save(BookingBenefitAccount, acc);

      await em.save(
        BookingBenefitLedger,
        em.create(BookingBenefitLedger, {
          accountId: acc.id,
          bookingId: intent.bookingId,
          hotelId: String(intent.hotelId),
          campaignId: acc.campaignId,
          entryType: BenefitLedgerEntryType.REFUND_SETTLEMENT,
          amountDelta: -refundAmt,
          balanceAfter: acc.availableAmount,
          quotaDelta: 0,
          quotaAfter: acc.availableQuota,
          performedBy: actor.id,
          idempotencyKey: intent.idempotencyKey,
          reason: intent.reason || `Xác nhận hoàn tiền thành công (${refundAmt.toLocaleString('vi-VN')}đ)`,
        }),
      );

      return { settledRefundAmount: refundAmt, status: intent.status, refundIntent: intent, account: acc };
    });
  }

  async grantQuoteBenefitsForPaidBooking(bookingId: string) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId }, lock: { mode: 'pessimistic_write' } });
      if (!booking) return [];
      const confirmedQuote = await em.findOne(BookingPriceQuote, {
        where: { bookingId: booking.id, status: 'CONFIRMED' },
        order: { id: 'DESC' },
      });
      if (!confirmedQuote || !Array.isArray(confirmedQuote.appliedCampaigns)) return [];

      const granted: BookingBenefitAccount[] = [];
      for (const applied of confirmedQuote.appliedCampaigns) {
        const camp = await em.findOne(PromotionCampaign, {
          where: { id: applied.campaignId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!camp) continue;
        const appliedAmt = Math.max(0, Math.round(Number(applied.discountAmount || 0)));
        if (appliedAmt > 0 && Number(camp.budgetReserved || 0) >= appliedAmt) {
          camp.budgetReserved = Math.max(0, Number(camp.budgetReserved || 0) - appliedAmt);
          camp.budgetConsumed = Number(camp.budgetConsumed || 0) + appliedAmt;
          await em.save(PromotionCampaign, camp);
        }
        const totalQuota = (camp.packageConfig?.includedQuotas || []).reduce((s, q) => s + Number(q.quantity || 0), 0);
        const isServiceBenefit =
          camp.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT ||
          camp.benefitKind === BenefitKind.INCLUDED_QUOTA ||
          totalQuota > 0;
        if (!isServiceBenefit || (appliedAmt <= 0 && totalQuota <= 0)) continue;

        const dedupeKey = `quote_benefit:booking:${booking.id}:camp:${camp.id}:v:${camp.version}`;
        if (await em.findOne(BookingBenefitAccount, { where: { dedupeKey } })) continue;

        const quotaCodes = (camp.packageConfig?.includedQuotas || []).map((q) => String(q.serviceCode || '')).filter(Boolean);
        const allowedServices = camp.targetServiceIds?.length ? camp.targetServiceIds : quotaCodes.length ? quotaCodes : null;
        const creditAmt = camp.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT ? appliedAmt : 0;

        const account = await em.save(
          BookingBenefitAccount,
          em.create(BookingBenefitAccount, {
            bookingId: booking.id,
            hotelId: String(booking.hotelId),
            campaignId: camp.id,
            benefitKind: camp.benefitKind,
            sourceType: 'QUOTE_BENEFIT',
            status: BenefitAccountStatus.APPROVED,
            currency: 'VND',
            grantedAmount: creditAmt,
            redeemedAmount: 0,
            reversedAmount: 0,
            refundedAmount: 0,
            availableAmount: creditAmt,
            grantedQuota: totalQuota,
            usedQuota: 0,
            availableQuota: totalQuota,
            allowedServiceIds: allowedServices,
            customerAcceptedCredit: true,
            expiresAt: new Date(booking.checkOutAt),
            dedupeKey,
            approvedBy: camp.approvedBy || null,
            approvedAt: new Date(),
            note: `Quyền lợi từ báo giá thanh toán (${camp.code})`,
            version: 1,
          }),
        );

        await em.save(
          BookingBenefitLedger,
          em.create(BookingBenefitLedger, {
            accountId: account.id,
            bookingId: booking.id,
            hotelId: String(booking.hotelId),
            campaignId: camp.id,
            entryType: BenefitLedgerEntryType.GRANT,
            amountDelta: creditAmt,
            balanceAfter: creditAmt,
            quotaDelta: totalQuota,
            quotaAfter: totalQuota,
            performedBy: booking.userId || null,
            idempotencyKey: `grant:${dedupeKey}`,
            reason: `Cấp quyền lợi theo báo giá đã thanh toán (${creditAmt}đ)`,
          }),
        );
        granted.push(account);
      }
      return granted;
    });
  }

  async getBookingBenefitsAndFolio(bookingId: string, actor: { id: string; role: string }) {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    if (actor.role === 'CUSTOMER') {
      if (String(booking.userId) !== String(actor.id)) {
        throw new ForbiddenException('Bạn không có quyền xem sổ quyền lợi của đơn đặt phòng người khác.');
      }
    } else if (actor.role !== 'ADMIN') {
      await assertBookingOperator(this.bookingRepo.manager, booking, actor);
    }

    const [accounts, ledger] = await Promise.all([
      this.accountRepo.find({ where: { bookingId }, order: { id: 'ASC' } }),
      this.ledgerRepo.find({ where: { bookingId }, order: { id: 'ASC' } }),
    ]);

    let refundIntents: PromotionRefundIntent[] = [];
    try {
      refundIntents = await this.dataSource.getRepository(PromotionRefundIntent).find({
        where: { bookingId },
        order: { id: 'DESC' },
      });
    } catch {}

    const adjustmentRefundableWithoutConsent = accounts
      .filter((a) => a.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT && !a.customerAcceptedCredit && a.status === BenefitAccountStatus.APPROVED)
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

    const refundableButOffsetPermitted = accounts
      .filter((a) => a.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT && a.customerAcceptedCredit && a.status === BenefitAccountStatus.APPROVED)
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

    const pureServiceVoucher = accounts
      .filter(
        (a) =>
          a.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT &&
          a.status === BenefitAccountStatus.APPROVED &&
          (!a.expiresAt || new Date(a.expiresAt) > new Date()),
      )
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

    const pendingRefundSettlementAmount = accounts
      .filter((a) => a.status === BenefitAccountStatus.REFUND_PENDING)
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

    const totalOutstandingLiability =
      adjustmentRefundableWithoutConsent +
      refundableButOffsetPermitted +
      pureServiceVoucher +
      pendingRefundSettlementAmount;

    const refundReceivableAmount = adjustmentRefundableWithoutConsent + refundableButOffsetPermitted;
    const availableServiceCredit = refundableButOffsetPermitted + pureServiceVoucher;
    const availableQuota = accounts
      .filter((a) => a.status === BenefitAccountStatus.APPROVED)
      .reduce((s, a) => s + Number(a.availableQuota || 0), 0);

    return {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      hotelId: booking.hotelId,
      originalEstimatedTotal: Number(booking.estimatedTotal || 0),
      refundReceivableAmount,
      availableServiceCredit,
      availableQuota,
      adjustmentRefundableWithoutConsent,
      refundableButOffsetPermitted,
      pureServiceVoucher,
      pendingRefundSettlementAmount,
      totalOutstandingLiability,
      refundIntents,
      accounts,
      ledger,
    };
  }
}
