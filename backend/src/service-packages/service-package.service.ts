import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

export interface ServicePackageDefinition {
  id: string;
  hotelId: string;
  code: string;
  name: string;
  packagePriceVnd: number;
  dailyCapacity: number | null;
  availableFromHour: number | null;
  availableToHour: number | null;
  includedServices: Array<{ serviceId: string; quotaUnits: number }>;
}

@Injectable()
export class ServicePackageService {
  private readonly redeemedUnitKeys = new Set<string>();
  private readonly slotBookingsCount = new Map<string, number>();

  /**
   * Validates service package / add-on slot capacity and prevents double-redeeming
   * both package quota and promotion campaign quota for the same service unit (IMP-16 / GAP-16).
   */
  reserveServicePackageSlot(params: {
    bookingId: string;
    pkg: ServicePackageDefinition;
    serviceId: string;
    serviceDate: string;
    requestedHour?: number;
    unitsRequested: number;
    quotaSource: 'PACKAGE_QUOTA' | 'CAMPAIGN_QUOTA';
    serviceRequestUnitKey: string;
    effectiveExecutorId: string | null;
  }) {
    if (
      params.pkg.availableFromHour !== null &&
      params.pkg.availableToHour !== null &&
      params.requestedHour !== undefined
    ) {
      if (
        params.requestedHour < params.pkg.availableFromHour ||
        params.requestedHour >= params.pkg.availableToHour
      ) {
        throw new BadRequestException(
          `SERVICE_OUTSIDE_OPERATING_HOURS: Dịch vụ chỉ phục vụ trong khung giờ [${params.pkg.availableFromHour}:00, ${params.pkg.availableToHour}:00).`,
        );
      }
    }

    const dedupUnitKey = `${params.bookingId}:${params.serviceRequestUnitKey}`;
    if (this.redeemedUnitKeys.has(dedupUnitKey)) {
      throw new ConflictException(
        'DOUBLE_QUOTA_REDEMPTION_BLOCKED: Đơn vị dịch vụ này đã được cấn trừ hạn mức (không được dùng đồng thời cả Package Quota và Campaign Quota cho cùng 1 lượt).',
      );
    }

    const capKey = `${params.pkg.id}:${params.serviceId}:${params.serviceDate}`;
    const currentUsed = this.slotBookingsCount.get(capKey) || 0;
    if (
      params.pkg.dailyCapacity !== null &&
      currentUsed + params.unitsRequested > params.pkg.dailyCapacity
    ) {
      throw new ConflictException(
        `SERVICE_PACKAGE_CAPACITY_EXHAUSTED: Gói dịch vụ "${params.pkg.name}" đã hết suất vào ngày ${params.serviceDate}.`,
      );
    }

    this.slotBookingsCount.set(capKey, currentUsed + params.unitsRequested);
    this.redeemedUnitKeys.add(dedupUnitKey);

    return {
      bookingId: params.bookingId,
      packageId: params.pkg.id,
      serviceId: params.serviceId,
      serviceDate: params.serviceDate,
      unitsReserved: params.unitsRequested,
      quotaSource: params.quotaSource,
      assignedExecutorId: params.effectiveExecutorId,
    };
  }
}
