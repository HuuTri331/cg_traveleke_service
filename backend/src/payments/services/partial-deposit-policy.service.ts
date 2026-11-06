import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { HotelFeatureFlagKey } from '../../property-settings/entities/hotel-feature-flag.entity';
import { FeatureFlagsService } from '../../property-settings/feature-flags.service';

@Injectable()
export class PartialDepositAndGuestTokenService {
  private readonly guestTokensByHash = new Map<string, any>();

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  /**
   * IMP-15 / GAP-15 (NP-17): Partial Deposit & Security Deposit Escrow — OFF by default.
   * Paying a 30% deposit NEVER marks the full booking as 100% settled; refund never exceeds verified collected amount.
   */
  async evaluateDepositSchedule(params: {
    hotelId: string;
    totalPayableVnd: number;
    depositPaidVnd: number;
    requestedRefundVnd?: number;
  }) {
    const enabled = await this.featureFlags.isEnabled(
      params.hotelId,
      HotelFeatureFlagKey.FF_PARTIAL_DEPOSIT,
    );
    if (!enabled) {
      throw new ServiceUnavailableException(
        'PARTIAL_DEPOSIT_DISABLED: Tính năng đặt cọc từng phần (GAP-15) đang tắt theo mặc định.',
      );
    }

    const total = Math.round(Number(params.totalPayableVnd));
    const paid = Math.round(Number(params.depositPaidVnd));
    if (params.requestedRefundVnd !== undefined && params.requestedRefundVnd > paid) {
      throw new ConflictException(
        `REFUND_EXCEEDS_COLLECTED_DEPOSIT: Số tiền hoàn (${params.requestedRefundVnd}) không được vượt quá số tiền thực thu (${paid}).`,
      );
    }

    return {
      totalPayableVnd: total,
      depositPaidVnd: paid,
      remainingBalanceVnd: Math.max(0, total - paid),
      isFullStaySettled: paid >= total,
      paymentPolicyState: paid >= total ? 'FULLY_PAID' : paid > 0 ? 'DEPOSIT_PAID_PARTIAL' : 'UNPAID',
    };
  }

  /**
   * IMP-29 / GAP-29 (NP-17): Scoped Guest Magic-Link Access Token — OFF by default.
   * Stores only SHA-256 hash, strictly scopes to VIEW/PRECHECKIN (never REFUND), and supports one-time account claim.
   */
  async issueScopedGuestAccessToken(params: {
    hotelId: string;
    bookingId: string;
    email: string;
    requestedScopes: string[];
  }) {
    const enabled = await this.featureFlags.isEnabled(
      params.hotelId,
      HotelFeatureFlagKey.FF_GUEST_MAGIC_CHECKOUT,
    );
    if (!enabled) {
      throw new ServiceUnavailableException(
        'GUEST_MAGIC_CHECKOUT_DISABLED: Tính năng Guest Checkout không tài khoản (GAP-29) đang tắt theo mặc định.',
      );
    }

    if (params.requestedScopes.includes('REFUND') || params.requestedScopes.includes('CANCEL_WITH_REFUND')) {
      throw new ForbiddenException('GUEST_TOKEN_SCOPE_FORBIDDEN: Magic-link không được cấp quyền tự hoàn tiền (REFUND).');
    }

    const rawToken = `gbt_${randomBytes(24).toString('hex')}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = {
      bookingId: String(params.bookingId),
      email: params.email.trim().toLowerCase(),
      tokenHash,
      scopes: params.requestedScopes,
      claimedByUserId: null as string | null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    this.guestTokensByHash.set(tokenHash, record);
    return { rawToken, tokenHash, scopes: record.scopes };
  }

  claimGuestBookingToAccount(rawToken: string, userId: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = this.guestTokensByHash.get(tokenHash);
    if (!record) throw new BadRequestException('Token không tồn tại.');
    if (record.claimedByUserId && String(record.claimedByUserId) !== String(userId)) {
      throw new ConflictException('GUEST_BOOKING_ALREADY_CLAIMED: Đơn đặt phòng đã được liên kết vào một tài khoản khác.');
    }
    record.claimedByUserId = String(userId);
    return record;
  }
}
