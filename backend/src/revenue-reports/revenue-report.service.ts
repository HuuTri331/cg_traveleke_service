import { ForbiddenException, Injectable } from '@nestjs/common';

export interface DailyRevenueInput {
  businessDate: string;
  availableRoomNights: number;
  soldRoomNights: number;
  verifiedRoomRevenueVnd: number;
  verifiedServiceRevenueVnd: number;
  refundedVnd: number;
  noShowCount: number;
  cancelledCount: number;
}

@Injectable()
export class RevenueReportService {
  /**
   * Computes hospitality BI metrics (ADR, RevPAR, Occupancy, Net Revenue) per hotel (IMP-28 / GAP-28).
   * - Never uses unverified `estimatedTotal` as realized revenue.
   * - Subtracts verified refunds from net revenue.
   * - Keeps `noShowCount` separate from occupied room nights.
   */
  computeHotelRevenueMetrics(params: {
    hotelId: string;
    actorHotelId: string;
    actorRole: string;
    days: DailyRevenueInput[];
  }) {
    if (params.actorRole !== 'ADMIN' && String(params.hotelId) !== String(params.actorHotelId)) {
      throw new ForbiddenException('CROSS_HOTEL_ANALYTICS_FORBIDDEN: Quản lý không được xem báo cáo doanh thu của khách sạn khác.');
    }

    let totalAvailableNights = 0;
    let totalSoldNights = 0;
    let grossRoomRevenueVnd = 0;
    let serviceRevenueVnd = 0;
    let totalRefundedVnd = 0;
    let totalNoShows = 0;
    let totalCancelled = 0;

    for (const d of params.days) {
      totalAvailableNights += Math.max(0, Number(d.availableRoomNights || 0));
      totalSoldNights += Math.max(0, Number(d.soldRoomNights || 0));
      grossRoomRevenueVnd += Math.max(0, Math.round(Number(d.verifiedRoomRevenueVnd || 0)));
      serviceRevenueVnd += Math.max(0, Math.round(Number(d.verifiedServiceRevenueVnd || 0)));
      totalRefundedVnd += Math.max(0, Math.round(Number(d.refundedVnd || 0)));
      totalNoShows += Math.max(0, Number(d.noShowCount || 0));
      totalCancelled += Math.max(0, Number(d.cancelledCount || 0));
    }

    const netRoomRevenueVnd = Math.max(0, grossRoomRevenueVnd - totalRefundedVnd);
    const adrVnd = totalSoldNights > 0 ? Math.round(netRoomRevenueVnd / totalSoldNights) : 0;
    const revParVnd = totalAvailableNights > 0 ? Math.round(netRoomRevenueVnd / totalAvailableNights) : 0;
    const occupancyPct =
      totalAvailableNights > 0 ? Number(((totalSoldNights / totalAvailableNights) * 100).toFixed(2)) : 0;

    return {
      hotelId: String(params.hotelId),
      totalAvailableNights,
      totalSoldNights,
      occupancyPct,
      grossRoomRevenueVnd,
      totalRefundedVnd,
      netRoomRevenueVnd,
      serviceRevenueVnd,
      totalNetRevenueVnd: netRoomRevenueVnd + serviceRevenueVnd,
      adrVnd,
      revParVnd,
      totalNoShows,
      totalCancelled,
    };
  }
}
