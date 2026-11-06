import { createHash } from 'crypto';

export interface CancellationPolicySnapshot {
  policyCode: string;
  policyType: 'FLEXIBLE' | 'MODERATE' | 'NON_REFUNDABLE';
  freeCancelCutoffHours: number;
  lateCancelPenaltyType: 'FIRST_NIGHT' | 'PERCENT' | 'FULL_STAY';
  lateCancelPenaltyValue: number;
  noShowPenaltyType: 'FIRST_NIGHT' | 'PERCENT' | 'FULL_STAY';
  noShowPenaltyValue: number;
  firstNightAmountVnd: number;
  policyVersion: number;
}

export interface CancellationRefundPreview {
  status: 'EVALUATED' | 'LEGACY_POLICY_REVIEW' | 'NO_SHOW_NO_AUTO_REFUND';
  eligibleForRefund: boolean;
  autoRefundAllowed: boolean;
  verifiedPaidVnd: number;
  penaltyFeeVnd: number;
  refundableVnd: number;
  reason: string;
  quoteHash: string;
}

/**
 * Pure cancellation & no-show policy evaluator (IMP-11 / GAP-11):
 * - Never uses `booking.estimatedTotal` as refund truth; uses `verifiedPaidVnd`.
 * - Legacy bookings without a policy snapshot go to `LEGACY_POLICY_REVIEW` (no retroactive rule imposition).
 * - No-show never triggers automatic refund (`autoRefundAllowed = false`).
 */
export function evaluateCancellationPolicyQuote(params: {
  bookingId: string;
  checkInAt: Date | string;
  cancelledAt: Date | string;
  verifiedPaidVnd: number;
  snapshot: CancellationPolicySnapshot | null | undefined;
  isNoShow?: boolean;
}): CancellationRefundPreview {
  const paid = Math.max(0, Math.round(Number(params.verifiedPaidVnd || 0)));

  if (!params.snapshot) {
    const legacyRes = {
      status: 'LEGACY_POLICY_REVIEW' as const,
      eligibleForRefund: false,
      autoRefundAllowed: false,
      verifiedPaidVnd: paid,
      penaltyFeeVnd: 0,
      refundableVnd: 0,
      reason: 'Booking cũ trước khi có snapshot chính sách hủy; chuyển Quản lý xét duyệt thủ công (LEGACY_POLICY_REVIEW).',
    };
    return {
      ...legacyRes,
      quoteHash: createHash('sha256').update(JSON.stringify({ bookingId: params.bookingId, ...legacyRes })).digest('hex'),
    };
  }

  const snap = params.snapshot;
  if (params.isNoShow) {
    let noShowPenalty = paid;
    if (snap.noShowPenaltyType === 'FIRST_NIGHT') {
      noShowPenalty = Math.min(paid, Math.round(Number(snap.firstNightAmountVnd || paid)));
    } else if (snap.noShowPenaltyType === 'PERCENT') {
      noShowPenalty = Math.min(paid, Math.round((paid * Number(snap.noShowPenaltyValue || 100)) / 100));
    }
    const refundable = Math.max(0, paid - noShowPenalty);
    const noShowRes = {
      status: 'NO_SHOW_NO_AUTO_REFUND' as const,
      eligibleForRefund: refundable > 0,
      autoRefundAllowed: false,
      verifiedPaidVnd: paid,
      penaltyFeeVnd: noShowPenalty,
      refundableVnd: refundable,
      reason: 'Khách NO_SHOW: áp dụng phí phạt vắng mặt theo snapshot, không tự động hoàn tiền khi chưa đối soát.',
    };
    return {
      ...noShowRes,
      quoteHash: createHash('sha256').update(JSON.stringify({ bookingId: params.bookingId, ...noShowRes })).digest('hex'),
    };
  }

  if (snap.policyType === 'NON_REFUNDABLE') {
    const nonRefRes = {
      status: 'EVALUATED' as const,
      eligibleForRefund: false,
      autoRefundAllowed: false,
      verifiedPaidVnd: paid,
      penaltyFeeVnd: paid,
      refundableVnd: 0,
      reason: 'Gói giá Không hoàn hủy (NON_REFUNDABLE) đã chốt tại thời điểm đặt phòng.',
    };
    return {
      ...nonRefRes,
      quoteHash: createHash('sha256').update(JSON.stringify({ bookingId: params.bookingId, ...nonRefRes })).digest('hex'),
    };
  }

  const checkInMs = new Date(params.checkInAt).getTime();
  const cancelMs = new Date(params.cancelledAt).getTime();
  const hoursBeforeCheckIn = (checkInMs - cancelMs) / (1000 * 60 * 60);

  let penaltyFeeVnd = 0;
  let reason = `Hủy trước mốc miễn phí (${snap.freeCancelCutoffHours}h trước check-in).`;

  if (hoursBeforeCheckIn < Number(snap.freeCancelCutoffHours || 0)) {
    if (snap.lateCancelPenaltyType === 'FIRST_NIGHT') {
      penaltyFeeVnd = Math.min(paid, Math.round(Number(snap.firstNightAmountVnd || paid)));
    } else if (snap.lateCancelPenaltyType === 'PERCENT') {
      penaltyFeeVnd = Math.min(paid, Math.round((paid * Number(snap.lateCancelPenaltyValue || 100)) / 100));
    } else {
      penaltyFeeVnd = paid;
    }
    reason = `Hủy muộn (${hoursBeforeCheckIn.toFixed(1)}h trước check-in < ${snap.freeCancelCutoffHours}h): trừ phí hủy muộn theo snapshot.`;
  }

  const refundableVnd = Math.max(0, paid - penaltyFeeVnd);
  const evalRes = {
    status: 'EVALUATED' as const,
    eligibleForRefund: refundableVnd > 0,
    autoRefundAllowed: false,
    verifiedPaidVnd: paid,
    penaltyFeeVnd,
    refundableVnd,
    reason,
  };
  return {
    ...evalRes,
    quoteHash: createHash('sha256').update(JSON.stringify({ bookingId: params.bookingId, ...evalRes })).digest('hex'),
  };
}
