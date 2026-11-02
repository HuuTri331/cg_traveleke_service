import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Room } from '../rooms/entities/room.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { CalculateQuoteDto, CreatePromotionCampaignDto, RedeemBenefitDto } from './dto/promotions.dto';
import { BenefitAccountStatus, BookingBenefitAccount } from './entities/booking-benefit-account.entity';
import { BenefitLedgerEntryType, BookingBenefitLedger } from './entities/booking-benefit-ledger.entity';
import { BookingPriceQuote } from './entities/booking-price-quote.entity';
import {
  BenefitKind, ChargeComponentType, PromotionCampaign, PromotionCampaignStatus,
  PromotionCampaignType, PromotionDiscountType, PromotionTargetScope,
} from './entities/promotion-campaign.entity';
import {
  addDaysToDateStr, computeNightlyQuote, detectCampaignConflicts, hasRemainingCampaignBudget, toLocalHotelDate,
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
      return await em.save(PromotionCampaign, campaign);
    });

    if (result.existingBookingsEligible) {
      await this.evaluateExistingBookingsForHotel(result.hotelId, actor);
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
    if (actor && actor.role === 'EMPLOYEE') {
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

  async getQuoteById(quoteId: string) {
    const quote = await this.quoteRepo.findOne({
      where: [{ id: quoteId }, { quoteCode: quoteId }],
    });
    if (!quote) throw new NotFoundException(`Không tìm thấy báo giá #${quoteId}`);
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

  async getHotelReconciliationReport(actor: { id: string; role: string }, hotelId: string) {
    await this.assertHotelManager(actor, hotelId);
    const [accounts, ledger] = await Promise.all([
      this.accountRepo.find({ where: { hotelId } }),
      this.ledgerRepo.find({ where: { hotelId } }),
    ]);
    const discrepancies: Array<{ accountId: string; bookingId: string; materialized: number; ledgerSum: number }> = [];
    for (const acc of accounts) {
      const sum = ledger
        .filter((e) => String(e.accountId) === String(acc.id))
        .reduce((s, e) => s + Number(e.amountDelta || 0), 0);
      if (Math.round(sum) !== Math.round(Number(acc.availableAmount || 0))) {
        discrepancies.push({
          accountId: acc.id,
          bookingId: acc.bookingId,
          materialized: Number(acc.availableAmount || 0),
          ledgerSum: sum,
        });
      }
    }
    return {
      hotelId,
      totalAccounts: accounts.length,
      totalLedgerEntries: ledger.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }

  async evaluateExistingBookingsForHotel(hotelId: string, actor?: { id: string; role: string }) {
    if (actor) await this.assertHotelManager(actor, hotelId);
    const bookings = await this.bookingRepo.find({
      where: {
        hotelId,
        status: In([
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.NO_SHOW,
        ]),
      },
    });
    const granted: BookingBenefitAccount[] = [];
    for (const b of bookings) {
      const res = await this.evaluateExistingBookingBenefits(b.id, actor);
      granted.push(...res);
    }
    return { evaluatedBookings: bookings.length, grantedCount: granted.length, granted };
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

      const activeCampaigns = await em.find(PromotionCampaign, {
        where: { hotelId: String(booking.hotelId), status: PromotionCampaignStatus.ACTIVE },
      });
      const createdAccounts: BookingBenefitAccount[] = [];

      for (const br of bookingRooms) {
        const room = await em.findOne(Room, { where: { id: br.roomId } });
        const baseRate = Number(br.pricePerNight || room?.pricePerNight || 0);
        const quote = computeNightlyQuote({
          hotelId: String(booking.hotelId),
          roomId: String(br.roomId),
          baseRatePerNight: baseRate,
          roomQuantity: Number(br.quantity || booking.requestedRoomCount || 1),
          totalGuests: Number(booking.totalGuests || 1),
          checkInAt: booking.checkInAt,
          checkOutAt: booking.checkOutAt,
          activeCampaigns,
          forExistingBooking: true,
        });

        for (const applied of quote.appliedCampaigns) {
          if (applied.discountAmount <= 0) continue;
          const camp = await em.findOne(PromotionCampaign, {
            where: { id: applied.campaignId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!camp || camp.status !== PromotionCampaignStatus.ACTIVE) continue;

          const todayLocal = toLocalHotelDate(new Date(), camp.hotelTimezone || 'Asia/Ho_Chi_Minh');
          const discountedNights = quote.nightlyLines.filter(
            (l) => String(l.appliedCampaignId) === String(camp.id) && l.discountAmount > 0,
          );
          if (discountedNights.every((l) => l.nightDate < todayLocal) && !camp.retroactiveMode) {
            continue;
          }

          if (!hasRemainingCampaignBudget(camp, applied.discountAmount)) {
            if (camp.budgetTotal !== null) {
              camp.status = PromotionCampaignStatus.EXHAUSTED;
              await em.save(PromotionCampaign, camp);
            }
            continue;
          }

          const dedupeKey = `booking:${booking.id}:room:${br.roomId}:camp:${camp.id}:v:${camp.version}`;
          const existingAcc = await em.findOne(BookingBenefitAccount, { where: { dedupeKey } });
          if (existingAcc) continue;

          const totalQuota = (camp.packageConfig?.includedQuotas || []).reduce(
            (s, q) => s + Number(q.quantity || 0),
            0,
          );

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
              grantedAmount: applied.discountAmount,
              redeemedAmount: 0,
              reversedAmount: 0,
              refundedAmount: 0,
              availableAmount: applied.discountAmount,
              grantedQuota: totalQuota,
              usedQuota: 0,
              availableQuota: totalQuota,
              allowedServiceIds: camp.targetServiceIds || null,
              customerAcceptedCredit: camp.benefitKind !== BenefitKind.ROOM_PRICE_ADJUSTMENT,
              expiresAt: camp.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT ? null : new Date(booking.checkOutAt),
              dedupeKey,
              approvedBy: actor?.id || camp.approvedBy || null,
              approvedAt: new Date(),
              note: `Quyền lợi từ chiến dịch ${camp.name} (${camp.code}) cho ${discountedNights.length} đêm`,
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
              amountDelta: applied.discountAmount,
              balanceAfter: applied.discountAmount,
              quotaDelta: totalQuota,
              quotaAfter: totalQuota,
              performedBy: actor?.id || null,
              idempotencyKey: `grant:${dedupeKey}`,
              reason: `Cấp quyền lợi ${camp.benefitKind} (${applied.discountAmount.toLocaleString('vi-VN')}đ)`,
              metadata: {
                discountedNights: discountedNights.map((d) => ({
                  nightDate: d.nightDate,
                  discountAmount: d.discountAmount,
                })),
              },
            }),
          );

          camp.budgetReserved = Number(camp.budgetReserved || 0) + applied.discountAmount;
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
  ) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, { where: { id: bookingId } });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn chỉ có thể xác nhận phương án cấn trừ cho đơn của chính mình.');
        }
      } else {
        await assertBookingOperator(em, booking, actor);
      }

      const acc = await em.findOne(BookingBenefitAccount, {
        where: { id: accountId, bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${accountId}`);
      acc.customerAcceptedCredit = true;
      acc.version += 1;
      return await em.save(BookingBenefitAccount, acc);
    });
  }

  async redeemBenefitForService(actor: { id: string; role: string }, dto: RedeemBenefitDto) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: dto.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}`);

      await assertBookingOperator(em, booking, actor, 'SERVICE_REQUEST');

      const existingEntries = await em.find(BookingBenefitLedger, {
        where: { bookingId: booking.id },
      });
      const matched = existingEntries.filter(
        (e) =>
          e.idempotencyKey === dto.idempotencyKey ||
          e.idempotencyKey.startsWith(`${dto.idempotencyKey}:acc:`),
      );
      if (matched.length > 0) {
        return {
          redeemedAmount: matched.reduce((s, e) => s + Math.abs(Number(e.amountDelta)), 0),
          redeemedQuota: matched.reduce((s, e) => s + Math.abs(Number(e.quotaDelta)), 0),
          remainingServicePayable: 0,
          isIdempotentRepeat: true,
        };
      }

      const accounts = await em
        .getRepository(BookingBenefitAccount)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where("a.booking_id = :bookingId AND a.status = 'APPROVED'", { bookingId: booking.id })
        .orderBy('a.id', 'ASC')
        .getMany();

      let remainingToRedeem = Math.max(0, Math.round(Number(dto.requestedAmount || 0)));
      let remainingQuotaToRedeem = Math.max(0, Math.round(Number(dto.requestedQuota || 0)));
      let totalRedeemedAmount = 0;
      let totalRedeemedQuota = 0;

      for (const acc of accounts) {
        if (acc.expiresAt && new Date(acc.expiresAt) <= new Date()) continue;
        if (
          dto.serviceId &&
          Array.isArray(acc.allowedServiceIds) &&
          acc.allowedServiceIds.length > 0 &&
          !acc.allowedServiceIds.map(String).includes(String(dto.serviceId))
        ) {
          continue;
        }
        if (
          acc.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT &&
          !acc.customerAcceptedCredit &&
          !dto.customerAgreedToOffset
        ) {
          throw new ConflictException(
            'Khoản giảm giá phòng (ROOM_PRICE_ADJUSTMENT) là tiền phải hoàn; cần khách hàng xác nhận đồng ý cấn trừ dịch vụ trước khi trừ.',
          );
        }
        if (dto.customerAgreedToOffset && !acc.customerAcceptedCredit) {
          acc.customerAcceptedCredit = true;
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

        await em.save(
          BookingBenefitLedger,
          em.create(BookingBenefitLedger, {
            accountId: acc.id,
            bookingId: booking.id,
            hotelId: String(booking.hotelId),
            campaignId: acc.campaignId,
            entryType: BenefitLedgerEntryType.REDEEM,
            amountDelta: -useAmt,
            balanceAfter: acc.availableAmount,
            quotaDelta: -useQ,
            quotaAfter: acc.availableQuota,
            serviceRequestId: dto.serviceRequestId || null,
            performedBy: actor.id,
            idempotencyKey: `${dto.idempotencyKey}:acc:${acc.id}`,
            reason: dto.reason || `Cấn trừ dịch vụ #${dto.serviceRequestId || 'quầy'}`,
          }),
        );

        remainingToRedeem -= useAmt;
        remainingQuotaToRedeem -= useQ;
        totalRedeemedAmount += useAmt;
        totalRedeemedQuota += useQ;
        if (remainingToRedeem === 0 && remainingQuotaToRedeem === 0) break;
      }

      if (totalRedeemedAmount === 0 && totalRedeemedQuota === 0) {
        throw new ConflictException('Không còn số dư quyền lợi hoặc quota hợp lệ để cấn trừ.');
      }

      return {
        redeemedAmount: totalRedeemedAmount,
        redeemedQuota: totalRedeemedQuota,
        remainingServicePayable: remainingToRedeem,
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
  ) {
    return await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      await this.assertHotelManager(actor, String(booking.hotelId));

      const acc = await em.findOne(BookingBenefitAccount, {
        where: { id: accountId, bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${accountId}`);
      if (acc.benefitKind !== BenefitKind.ROOM_PRICE_ADJUSTMENT) {
        throw new BadRequestException('Chỉ khoản giảm giá phòng (ROOM_PRICE_ADJUSTMENT) mới được tất toán hoàn tiền mặt/chuyển khoản.');
      }

      const refundAmt = Math.max(0, Math.round(Number(acc.availableAmount || 0)));
      if (refundAmt <= 0) {
        return { settledRefundAmount: 0, account: acc };
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

      return { settledRefundAmount: refundAmt, account: acc };
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

    const refundReceivableAmount = accounts
      .filter((a) => a.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT && a.status === BenefitAccountStatus.APPROVED)
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

    const availableServiceCredit = accounts
      .filter(
        (a) =>
          a.status === BenefitAccountStatus.APPROVED &&
          (!a.expiresAt || new Date(a.expiresAt) > new Date()) &&
          (a.benefitKind === BenefitKind.SERVICE_BENEFIT_CREDIT || a.customerAcceptedCredit),
      )
      .reduce((s, a) => s + Number(a.availableAmount || 0), 0);

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
      accounts,
      ledger,
    };
  }
}
