import {
  BenefitKind,
  ChargeComponentType,
  PromotionCampaign,
  PromotionCampaignStatus,
  PromotionCampaignType,
  PromotionDiscountType,
  PromotionTargetScope,
} from './entities/promotion-campaign.entity';
import {
  addDaysToDateStr,
  computeNightlyQuote,
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
  });
});
