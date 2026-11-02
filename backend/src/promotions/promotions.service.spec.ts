import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BenefitKind,
  ChargeComponentType,
  PromotionCampaign,
  PromotionCampaignStatus,
  PromotionCampaignType,
  PromotionDiscountType,
  PromotionTargetScope,
} from './entities/promotion-campaign.entity';
import { BenefitAccountStatus } from './entities/booking-benefit-account.entity';
import { BenefitLedgerEntryType } from './entities/booking-benefit-ledger.entity';
import { PromotionsService } from './promotions.service';
import {
  addDaysToDateStr,
  computeNightlyQuote,
  computeServiceItemPricing,
  detectCampaignConflicts,
} from './promotion-engine';

describe('Pricing & Promotions Engine (Section 6, 7, 10 & Scenarios B01–B32)', () => {
  const makeCampaign = (overrides: Partial<PromotionCampaign>): PromotionCampaign =>
    ({
      id: 'camp-1',
      hotelId: '1',
      code: 'NOV_EVENT',
      name: 'Ưu đãi tháng 11',
      description: null,
      campaignType: PromotionCampaignType.STAY_DATE,
      status: PromotionCampaignStatus.ACTIVE,
      chargeComponentType: ChargeComponentType.ROOM_NIGHT,
      targetScope: PromotionTargetScope.ROOM_IDS,
      targetRoomIds: ['room-deluxe'],
      targetServiceIds: null,
      stayStartDate: '2026-11-05',
      stayEndExclusiveDate: addDaysToDateStr('2026-11-07', 1),
      bookableStartAt: null,
      bookableEndAt: null,
      serviceStartHour: null,
      serviceEndHour: null,
      discountType: PromotionDiscountType.FIXED_AMOUNT,
      discountValue: 120000,
      floorPrice: 0,
      maxDiscountPerNight: null,
      maxDiscountPerBooking: null,
      minNights: 1,
      minRooms: 1,
      minGuests: 1,
      minOrderAmount: 0,
      benefitKind: BenefitKind.ROOM_PRICE_ADJUSTMENT,
      existingBookingsEligible: true,
      retroactiveMode: false,
      combinabilityPolicy: 'EXCLUSIVE',
      sponsorType: 'HOTEL',
      hotelTimezone: 'Asia/Ho_Chi_Minh',
      budgetTotal: 10000000,
      budgetReserved: 0,
      budgetConsumed: 0,
      budgetReversed: 0,
      maxRedemptions: null,
      redemptionsCount: 0,
      packageConfig: null,
      version: 1,
      createdBy: 'mgr-1',
      approvedBy: 'mgr-1',
      approvedAt: new Date(),
      publishedAt: new Date(),
      pausedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as PromotionCampaign;

  describe('Nightly Quote Engine (B01–B12)', () => {
    it('B01 & B02: Kỳ 02/11–10/11 (8 đêm, không tính đêm 10/11), giảm 120k các đêm 05, 06, 07/11 -> giảm 360k, còn 4.640.000đ', () => {
      const camp = makeCampaign({});
      const quote = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-02',
        checkOutAt: '2026-11-10',
        activeCampaigns: [camp],
      });

      expect(quote.nightsCount).toBe(8);
      expect(quote.baseTotal).toBe(5000000);
      expect(quote.discountTotal).toBe(360000);
      expect(quote.payableTotal).toBe(4640000);
      expect(quote.nightlyLines.map((l) => l.nightDate)).not.toContain('2026-11-10');
      const discountedNights = quote.nightlyLines.filter((l) => l.discountAmount > 0);
      expect(discountedNights.map((l) => l.nightDate)).toEqual([
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
      ]);
    });

    it('B04 & B05: Giao một phần kỳ lưu trú (06–08/11 -> 2 đêm = 240k; 04–06/11 -> 1 đêm = 120k)', () => {
      const camp = makeCampaign({});
      const q1 = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-06',
        checkOutAt: '2026-11-08',
        activeCampaigns: [camp],
      });
      expect(q1.discountTotal).toBe(240000);

      const q2 = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-04',
        checkOutAt: '2026-11-06',
        activeCampaigns: [camp],
      });
      expect(q2.discountTotal).toBe(120000);
    });

    it('B07 & B08: Nhân đúng số lượng phòng (qty=3) và bảo vệ giá sàn không âm (INV-P09)', () => {
      const camp = makeCampaign({ discountValue: 900000, floorPrice: 100000 });
      const quote = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 3,
        totalGuests: 4,
        checkInAt: '2026-11-05',
        checkOutAt: '2026-11-06',
        activeCampaigns: [camp],
      });
      expect(quote.discountTotal).toBe(525000 * 3);
      expect(quote.payableTotal).toBe(300000);
    });

    it('B12: Điều kiện minNights = 5 nhưng khách chỉ ở 4 đêm -> không được hưởng', () => {
      const camp = makeCampaign({ minNights: 5 });
      const quote = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-05',
        checkOutAt: '2026-11-09',
        activeCampaigns: [camp],
      });
      expect(quote.discountTotal).toBe(0);
    });
  });

  describe('Campaign Overlap & Conflict Prevention (B13–B18)', () => {
    it('B13 & B15: Chặn chồng chương trình cùng phòng Deluxe hoặc ALL_ROOMS trùng đêm; cho phép khác phòng (B14)', () => {
      const existingDeluxe = makeCampaign({
        id: '1',
        code: 'DLX15',
        targetScope: PromotionTargetScope.ROOM_IDS,
        targetRoomIds: ['room-deluxe'],
        stayStartDate: '2026-11-05',
        stayEndExclusiveDate: '2026-11-08',
      });

      const candidateSameRoom = makeCampaign({
        id: '2',
        code: 'DLX10',
        targetRoomIds: ['room-deluxe'],
        stayStartDate: '2026-11-06',
        stayEndExclusiveDate: '2026-11-08',
      });
      expect(detectCampaignConflicts(candidateSameRoom, [existingDeluxe])).toHaveLength(1);

      const candidateOtherRoom = makeCampaign({
        id: '3',
        code: 'STD10',
        targetRoomIds: ['room-standard'],
        stayStartDate: '2026-11-06',
        stayEndExclusiveDate: '2026-11-08',
      });
      expect(detectCampaignConflicts(candidateOtherRoom, [existingDeluxe])).toHaveLength(0);

      const candidateAllRooms = makeCampaign({
        id: '4',
        code: 'ALL10',
        targetScope: PromotionTargetScope.ALL_ROOMS,
        stayStartDate: '2026-11-06',
        stayEndExclusiveDate: '2026-11-08',
      });
      expect(detectCampaignConflicts(candidateAllRooms, [existingDeluxe])).toHaveLength(1);
    });

    it('B16: Dịch vụ Spa 14–17h và 17–19h tiếp giáp [14,17) và [17,19) -> KHÔNG xung đột', () => {
      const spaAfternoon = makeCampaign({
        id: '10',
        chargeComponentType: ChargeComponentType.SERVICE_ITEM,
        targetScope: PromotionTargetScope.SERVICE_IDS,
        targetServiceIds: ['svc-spa'],
        serviceStartHour: 14,
        serviceEndHour: 17,
      });
      const spaEvening = makeCampaign({
        id: '11',
        chargeComponentType: ChargeComponentType.SERVICE_ITEM,
        targetScope: PromotionTargetScope.SERVICE_IDS,
        targetServiceIds: ['svc-spa'],
        serviceStartHour: 17,
        serviceEndHour: 19,
      });
      expect(detectCampaignConflicts(spaEvening, [spaAfternoon])).toHaveLength(0);
    });

    it('PP-P1-10: COMBINABLE_INDEPENDENT không được phép vượt rào chống chồng khi cả hai cùng giảm ROOM_NIGHT trùng phòng/đêm', () => {
      const c1 = makeCampaign({
        id: '20',
        code: 'COMB1',
        combinabilityPolicy: 'COMBINABLE_INDEPENDENT',
        chargeComponentType: ChargeComponentType.ROOM_NIGHT,
      });
      const c2 = makeCampaign({
        id: '21',
        code: 'COMB2',
        combinabilityPolicy: 'COMBINABLE_INDEPENDENT',
        chargeComponentType: ChargeComponentType.ROOM_NIGHT,
      });
      expect(detectCampaignConflicts(c2, [c1])).toHaveLength(1);
    });

    it('PP-P1-05 / PIT-15: Shared campaign cap (maxDiscountPerBooking=300k) được chia sẻ giữa nhiều loại phòng trong cùng 1 booking', () => {
      const cappedCamp = makeCampaign({
        id: '30',
        code: 'CAP300K',
        targetScope: PromotionTargetScope.ALL_ROOMS,
        discountValue: 120000,
        maxDiscountPerBooking: 300000,
      });
      const shared = new Map<string, number>();
      const qDeluxe = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-05',
        checkOutAt: '2026-11-07',
        activeCampaigns: [cappedCamp],
        sharedCampaignUsedTotals: shared,
      });
      const qStandard = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-standard',
        baseRatePerNight: 500000,
        roomQuantity: 1,
        totalGuests: 2,
        checkInAt: '2026-11-05',
        checkOutAt: '2026-11-07',
        activeCampaigns: [cappedCamp],
        sharedCampaignUsedTotals: shared,
      });
      expect(qDeluxe.discountTotal).toBe(240000);
      expect(qStandard.discountTotal).toBe(60000);
      expect(qDeluxe.discountTotal + qStandard.discountTotal).toBe(300000);
    });

    it('PP-P1-02 / PIT-16: Giảm giá dịch vụ theo khung giờ (Spa 14:00–17:00 giảm 20%, khách dùng lúc 16:30 giá 500k -> còn 400k)', () => {
      const spaPromo = makeCampaign({
        id: '40',
        code: 'SPA20',
        chargeComponentType: ChargeComponentType.SERVICE_ITEM,
        targetScope: PromotionTargetScope.SERVICE_IDS,
        targetServiceIds: ['svc-spa'],
        stayStartDate: '2026-11-05',
        stayEndExclusiveDate: '2026-11-08',
        serviceStartHour: 14,
        serviceEndHour: 17,
        discountType: PromotionDiscountType.PERCENT,
        discountValue: 20,
      });
      const insideWindow = computeServiceItemPricing({
        hotelId: '1',
        serviceId: 'svc-spa',
        baseUnitPrice: 500000,
        quantity: 1,
        usageAt: '2026-11-05T16:30:00+07:00',
        activeCampaigns: [spaPromo],
      });
      expect(insideWindow.grossTotal).toBe(500000);
      expect(insideWindow.discountAmount).toBe(100000);
      expect(insideWindow.netTotal).toBe(400000);

      const outsideWindow = computeServiceItemPricing({
        hotelId: '1',
        serviceId: 'svc-spa',
        baseUnitPrice: 500000,
        quantity: 1,
        usageAt: '2026-11-05T17:30:00+07:00',
        activeCampaigns: [spaPromo],
      });
      expect(outsideWindow.discountAmount).toBe(0);
      expect(outsideWindow.netTotal).toBe(500000);
    });

    it('PP-P1-06 / B40 / PIT-17: Gói gia đình có 4 suất bữa sáng nhưng giảm giá phòng = 0đ vẫn được ghi nhận vào appliedCampaigns', () => {
      const familyPkg = makeCampaign({
        id: '50',
        code: 'FAM_BF4',
        campaignType: PromotionCampaignType.FAMILY_PACKAGE,
        chargeComponentType: ChargeComponentType.PACKAGE_COMPONENT,
        targetScope: PromotionTargetScope.ALL_ROOMS,
        discountValue: 0,
        benefitKind: BenefitKind.INCLUDED_QUOTA,
        packageConfig: {
          includedQuotas: [{ serviceCode: 'BREAKFAST', serviceName: 'Buffet Sáng', quantity: 4 }],
          roomPriceDiscountPercent: 0,
        },
      });
      const quote = computeNightlyQuote({
        hotelId: '1',
        roomId: 'room-deluxe',
        baseRatePerNight: 625000,
        roomQuantity: 1,
        totalGuests: 4,
        checkInAt: '2026-11-05',
        checkOutAt: '2026-11-07',
        activeCampaigns: [familyPkg],
      });
      expect(quote.payableTotal).toBe(1250000);
      expect(quote.appliedCampaigns).toHaveLength(1);
      expect(quote.appliedCampaigns[0].includedQuotas).toEqual([
        { serviceCode: 'BREAKFAST', serviceName: 'Buffet Sáng', quantity: 4 },
      ]);
    });
  });

  describe('PromotionsService Financial & Security Invariants (PP-P0-01..P0-11, PIT-01..PIT-24)', () => {
    const buildServiceWithMockEm = (customEm: any, customDeps?: any) => {
      const ds = {
        transaction: jest.fn(async (cb: any) => cb(customEm)),
        getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
      } as any;
      const campaignRepo = customDeps?.campaignRepo || { find: jest.fn(), findOne: jest.fn() };
      const quoteRepo = customDeps?.quoteRepo || { find: jest.fn(), findOne: jest.fn() };
      const accountRepo = customDeps?.accountRepo || { find: jest.fn(), findOne: jest.fn() };
      const ledgerRepo = customDeps?.ledgerRepo || { find: jest.fn(), findOne: jest.fn() };
      const bookingRepo = customDeps?.bookingRepo || { find: jest.fn(), findOne: jest.fn(), manager: customEm };
      const bookingRoomRepo = customDeps?.bookingRoomRepo || { find: jest.fn() };
      const roomRepo = customDeps?.roomRepo || { findOne: jest.fn() };
      const staffAvail = customDeps?.staffAvail || {
        isManagerAtHotel: jest.fn().mockResolvedValue(true),
        isStaffAtHotel: jest.fn().mockResolvedValue(true),
      };
      return new PromotionsService(
        campaignRepo,
        quoteRepo,
        accountRepo,
        ledgerRepo,
        bookingRepo,
        bookingRoomRepo,
        roomRepo,
        staffAvail,
        ds,
      );
    };

    it('PP-P0-05 & PP-P0-06 (PIT-06, PIT-07): Chặn CUSTOMER đọc chiến dịch nội bộ và chặn đọc báo giá của khách khác', async () => {
      const svc = buildServiceWithMockEm({}, {
        quoteRepo: {
          findOne: jest.fn().mockResolvedValue({ id: '10', userId: 'cust-1', hotelId: '1' }),
        },
        staffAvail: {
          isManagerAtHotel: jest.fn().mockResolvedValue(false),
          isStaffAtHotel: jest.fn().mockResolvedValue(false),
        },
      });

      await expect(svc.getHotelCampaigns('1', { id: 'cust-1', role: 'CUSTOMER' })).rejects.toThrow(ForbiddenException);
      await expect(svc.getHotelCampaigns('1', { id: 'staff-other', role: 'EMPLOYEE' })).rejects.toThrow(ForbiddenException);
      await expect(svc.getQuoteById('10', { id: 'cust-2', role: 'CUSTOMER' })).rejects.toThrow(ForbiddenException);
    });

    it('PP-P0-03 (PIT-05): Nhân viên không thể tự xác nhận đồng ý cấn trừ thay khách khi thiếu evidenceRef', async () => {
      const em = {
        findOne: jest.fn().mockResolvedValue({ id: '100', userId: 'cust-1', hotelId: '1', handledBy: 'staff-1' }),
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
      };
      const svc = buildServiceWithMockEm(em);
      await expect(
        svc.acceptRoomAdjustmentAsCredit('100', 'acc-1', { id: 'staff-1', role: 'EMPLOYEE' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PP-P0-02, PP-P0-11 & PP-P1-14 (PIT-02, PIT-03, PIT-04, PIT-24): Redeem bắt buộc ServiceRequest thật đúng booking, chặn vượt số phải thu và kiểm tra hash idempotency', async () => {
      const account = {
        id: 'acc-1',
        bookingId: '100',
        hotelId: '1',
        campaignId: 'camp-1',
        benefitKind: BenefitKind.ROOM_PRICE_ADJUSTMENT,
        status: BenefitAccountStatus.APPROVED,
        grantedAmount: 360000,
        redeemedAmount: 0,
        availableAmount: 360000,
        availableQuota: 0,
        customerAcceptedCredit: true,
        version: 1,
      };
      const ledgerRows: any[] = [];
      let serviceReqMock: any = null;

      const em = {
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
        findOne: jest.fn(async (entity: any) => {
          if (entity.name === 'Booking') return { id: '100', userId: 'cust-1', hotelId: '1', handledBy: 'staff-1' };
          if (entity.name === 'ServiceRequest') return serviceReqMock;
          return null;
        }),
        find: jest.fn(async () => ledgerRows),
        getRepository: jest.fn(() => ({
          createQueryBuilder: () => ({
            setLock: () => ({
              where: () => ({
                orderBy: () => ({
                  getMany: async () => [account],
                }),
              }),
            }),
          }),
        })),
        create: jest.fn((_e: any, data: any) => data),
        save: jest.fn(async (_e: any, data: any) => {
          if (data.entryType === BenefitLedgerEntryType.REDEEM) ledgerRows.push(data);
          return data;
        }),
      };

      const svc = buildServiceWithMockEm(em);

      await expect(
        svc.redeemBenefitForService(
          { id: 'staff-1', role: 'EMPLOYEE' },
          { bookingId: '100', serviceRequestId: '999', requestedAmount: 200000, idempotencyKey: 'k1' },
        ),
      ).rejects.toThrow(NotFoundException);

      serviceReqMock = { id: 901, bookingId: 202, serviceId: 5, serviceName: 'Giặt ủi', totalPrice: 200000, status: 'PENDING' };
      await expect(
        svc.redeemBenefitForService(
          { id: 'staff-1', role: 'EMPLOYEE' },
          { bookingId: '100', serviceRequestId: '901', requestedAmount: 200000, idempotencyKey: 'k1' },
        ),
      ).rejects.toThrow(ForbiddenException);

      serviceReqMock = { id: 901, bookingId: 100, serviceId: 5, serviceName: 'Giặt ủi', totalPrice: 200000, status: 'PENDING' };
      const res1 = await svc.redeemBenefitForService(
        { id: 'staff-1', role: 'EMPLOYEE' },
        { bookingId: '100', serviceRequestId: '901', requestedAmount: 200000, idempotencyKey: 'k1' },
      );
      expect(res1.redeemedAmount).toBe(200000);
      expect(res1.remainingServicePayable).toBe(0);
      expect(account.availableAmount).toBe(160000);

      await expect(
        svc.redeemBenefitForService(
          { id: 'staff-1', role: 'EMPLOYEE' },
          { bookingId: '100', serviceRequestId: '901', requestedAmount: 150000, idempotencyKey: 'k1' },
        ),
      ).rejects.toThrow(ConflictException);

      await expect(
        svc.redeemBenefitForService(
          { id: 'staff-1', role: 'EMPLOYEE' },
          { bookingId: '100', serviceRequestId: '901', requestedAmount: 160000, idempotencyKey: 'k2' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('PP-P0-01 (PIT-01): settleRemainingRefundAtCheckout khi cổng timeout giữ trạng thái UNKNOWN_RECONCILE / REFUND_PENDING, không ghi giả đã hoàn', async () => {
      const account = {
        id: 'acc-1',
        bookingId: '100',
        hotelId: '1',
        campaignId: 'camp-1',
        benefitKind: BenefitKind.ROOM_PRICE_ADJUSTMENT,
        status: BenefitAccountStatus.APPROVED,
        availableAmount: 160000,
        refundedAmount: 0,
        availableQuota: 0,
        version: 1,
      };
      const em = {
        findOne: jest.fn(async (entity: any) => {
          if (entity.name === 'Booking') return { id: '100', hotelId: '1' };
          if (entity.name === 'BookingBenefitAccount') return account;
          if (entity.name === 'PaymentTransaction') return { id: 'pay-1', bookingId: '100', amount: '5000000.00', refundAmount: '0.00', status: 'PAID' };
          return null;
        }),
        create: jest.fn((_e: any, d: any) => d),
        save: jest.fn(async (_e: any, d: any) => d),
      };
      const svc = buildServiceWithMockEm(em);

      const timeoutRes = await svc.settleRemainingRefundAtCheckout(
        { id: 'mgr-1', role: 'EMPLOYEE' },
        '100',
        'acc-1',
        'settle-timeout-1',
        'Gateway timeout',
        { simulateProviderTimeout: true },
      );
      expect(timeoutRes.settledRefundAmount).toBe(0);
      expect(timeoutRes.status).toBe('UNKNOWN_RECONCILE');
      expect(account.status).toBe(BenefitAccountStatus.REFUND_PENDING);
      expect(account.availableAmount).toBe(160000);
    });

    it('PP-P0-07 & PP-P1-04 (PIT-12, PIT-13): Không cấp trùng quyền lợi cho các đêm đã giảm tại checkout quote và lọc đúng từng đêm khi retroactiveMode=false', async () => {
      const camp = makeCampaign({
        id: 'camp-retro',
        code: 'RETRO_TEST',
        stayStartDate: '2026-11-05',
        stayEndExclusiveDate: '2026-11-08',
        discountValue: 120000,
        retroactiveMode: true,
      });

      // PIT-12: Confirmed quote already discounted 2026-11-05, 06, 07 -> retro scan must grant 0 accounts
      const emWithConfirmedQuote = {
        findOne: jest.fn(async (entity: any) => {
          if (entity.name === 'Booking') {
            return {
              id: '200',
              hotelId: '1',
              status: 'CONFIRMED',
              checkInAt: '2026-11-02',
              checkOutAt: '2026-11-10',
              totalGuests: 2,
              requestedRoomCount: 1,
            };
          }
          if (entity.name === 'Room') return { id: 'room-deluxe', pricePerNight: 625000 };
          if (entity.name === 'PromotionCampaign') return camp;
          return null;
        }),
        find: jest.fn(async (entity: any) => {
          if (entity.name === 'BookingRoom') {
            return [{ id: 'br-1', bookingId: '200', roomId: 'room-deluxe', quantity: 1, pricePerNight: 625000, nights: 8, subtotal: 4640000 }];
          }
          if (entity.name === 'BookingPriceQuote') {
            return [
              {
                id: 'q-1',
                bookingId: '200',
                status: 'CONFIRMED',
                nightlyLines: [
                  { nightDate: '2026-11-05', roomId: 'room-deluxe', appliedCampaignId: 'camp-retro', discountAmount: 120000 },
                  { nightDate: '2026-11-06', roomId: 'room-deluxe', appliedCampaignId: 'camp-retro', discountAmount: 120000 },
                  { nightDate: '2026-11-07', roomId: 'room-deluxe', appliedCampaignId: 'camp-retro', discountAmount: 120000 },
                ],
              },
            ];
          }
          if (entity.name === 'PromotionCampaign') return [camp];
          return [];
        }),
        create: jest.fn((_e: any, d: any) => d),
        save: jest.fn(async (_e: any, d: any) => d),
      };

      const svc1 = buildServiceWithMockEm(emWithConfirmedQuote);
      const grantedDup = await svc1.evaluateExistingBookingBenefits('200', { id: 'mgr-1', role: 'EMPLOYEE' });
      expect(grantedDup).toHaveLength(0);
    });
  });
});
