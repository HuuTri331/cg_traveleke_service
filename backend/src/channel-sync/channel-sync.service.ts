import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HotelFeatureFlagKey } from '../property-settings/entities/hotel-feature-flag.entity';
import { FeatureFlagsService } from '../property-settings/feature-flags.service';

@Injectable()
export class ChannelSyncAndWaitlistService {
  private readonly importedExternalIds = new Map<string, any>();
  private readonly waitlistSubscriptions = new Map<string, any>();

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  /**
   * IMP-26 / GAP-26 (NP-16): OTA / iCal Channel Sync — OFF by default.
   * Prohibits setting VNPay `PAID` on external OTA payloads and deduplicates `(channel, externalReservationId)`.
   */
  async importExternalReservationBlock(params: {
    hotelId: string;
    roomTypeId: string;
    channelCode: string;
    externalReservationId: string;
    startDate: string;
    endExclusiveDate: string;
    attemptToMarkVnPayPaid?: boolean;
  }) {
    const enabled = await this.featureFlags.isEnabled(
      params.hotelId,
      HotelFeatureFlagKey.FF_ICAL_CHANNEL_SYNC,
    );
    if (!enabled) {
      throw new ServiceUnavailableException(
        'CHANNEL_SYNC_DISABLED: Tính năng đồng bộ kênh OTA/iCal (GAP-26) đang tắt theo mặc định.',
      );
    }

    if (params.attemptToMarkVnPayPaid) {
      throw new ForbiddenException(
        'EXTERNAL_CHANNEL_CANNOT_FAKE_VNPAY_PAID: Cấm biến payload OTA/iCal thành giao dịch PAID của VNPay nội bộ.',
      );
    }

    const dedupKey = `${params.channelCode}:${params.externalReservationId}`;
    if (this.importedExternalIds.has(dedupKey)) {
      return { deduplicated: true, block: this.importedExternalIds.get(dedupKey) };
    }

    const block = {
      hotelId: String(params.hotelId),
      roomTypeId: String(params.roomTypeId),
      channelCode: params.channelCode,
      externalReservationId: params.externalReservationId,
      startDate: params.startDate,
      endExclusiveDate: params.endExclusiveDate,
      sourceType: 'OTA_EXTERNAL_BLOCK',
      paymentTruth: 'EXTERNAL_UNVERIFIED',
    };
    this.importedExternalIds.set(dedupKey, block);
    return { deduplicated: false, block };
  }

  /**
   * IMP-30 / GAP-30 (NP-16): Waitlist & Abandoned Checkout Recovery — OFF by default.
   * Never auto-holds inventory or auto-charges the customer when room becomes available;
   * requires marketing consent and a fresh quote at checkout.
   */
  async subscribeWaitlist(params: {
    hotelId: string;
    roomTypeId: string;
    customerId: string;
    startDate: string;
    endExclusiveDate: string;
    consent: boolean;
    customerAlreadyPaidForStay?: boolean;
  }) {
    const enabled = await this.featureFlags.isEnabled(
      params.hotelId,
      HotelFeatureFlagKey.FF_WAITLIST_RECOVERY,
    );
    if (!enabled) {
      throw new ServiceUnavailableException(
        'WAITLIST_DISABLED: Tính năng danh sách chờ (GAP-30) đang tắt theo mặc định.',
      );
    }
    if (!params.consent) {
      throw new ForbiddenException('WAITLIST_CONSENT_REQUIRED: Khách hàng phải đồng ý nhận thông báo khi có phòng trống.');
    }
    if (params.customerAlreadyPaidForStay) {
      throw new ConflictException('ALREADY_PAID_BOOKING_CANNOT_JOIN_WAITLIST: Khách đã thanh toán giữ chỗ không cần vào danh sách chờ.');
    }

    const entry = {
      hotelId: String(params.hotelId),
      roomTypeId: String(params.roomTypeId),
      customerId: String(params.customerId),
      startDate: params.startDate,
      endExclusiveDate: params.endExclusiveDate,
      status: 'WAITING',
      autoHoldCreated: false,
      autoPaymentCharged: false,
    };
    this.waitlistSubscriptions.set(`${params.hotelId}:${params.customerId}:${params.startDate}`, entry);
    return entry;
  }
}
