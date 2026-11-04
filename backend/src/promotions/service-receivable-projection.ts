import { BenefitLedgerEntryType, BookingBenefitLedger } from './entities/booking-benefit-ledger.entity';
import { ServiceRequest } from '../services/entities/service-request.entity';

export interface ServiceReceivableProjection {
  serviceRequestId: string;
  serviceId: string;
  serviceName: string;
  status: string;
  quantity: number;
  grossTotal: number;
  directDiscountAmount: number;
  netTotal: number;
  redeemedAmount: number;
  redeemedQuota: number;
  quotaCoveredAmount: number;
  creditsApplied: number;
  cashPaid: number;
  amountDue: number;
  remainingPayable: number;
  settlementStatus:
    | 'UNPAID'
    | 'PARTIALLY_OFFSET'
    | 'SETTLED_BY_BENEFIT'
    | 'SETTLED_AT_CHECKOUT'
    | 'CANCELLED';
}

/**
 * FIX-14 & Section VII: Nguồn tính toán duy nhất (Single Source of Truth) cho công nợ phiếu dịch vụ
 * giữa PromotionsService (Folio), ServicesService (Danh sách phiếu dịch vụ) và BookingPresenceService (Check-out).
 */
export function computeServiceReceivableProjection(
  sr: Pick<
    ServiceRequest,
    'id' | 'serviceId' | 'serviceName' | 'status' | 'quantity' | 'unitPrice' | 'totalPrice'
  > & { cashPaid?: number },
  ledgerEntries: Array<
    Pick<BookingBenefitLedger, 'serviceRequestId' | 'entryType' | 'amountDelta' | 'quotaDelta'>
  >,
  options?: { settledAtCheckoutByCash?: boolean },
): ServiceReceivableProjection {
  const srEntries = (ledgerEntries || []).filter(
    (e) => String(e.serviceRequestId) === String(sr.id),
  );

  const netAmountRedeemed = srEntries.reduce((sum, e) => {
    if (e.entryType === BenefitLedgerEntryType.REDEEM) {
      return sum + Math.abs(Math.round(Number(e.amountDelta || 0)));
    }
    if (e.entryType === BenefitLedgerEntryType.REVERSAL) {
      return sum - Math.abs(Math.round(Number(e.amountDelta || 0)));
    }
    return sum;
  }, 0);

  const netQuotaRedeemed = srEntries.reduce((sum, e) => {
    if (e.entryType === BenefitLedgerEntryType.REDEEM) {
      return sum + Math.abs(Math.round(Number(e.quotaDelta || 0)));
    }
    if (e.entryType === BenefitLedgerEntryType.REVERSAL) {
      return sum - Math.abs(Math.round(Number(e.quotaDelta || 0)));
    }
    return sum;
  }, 0);

  const qty = Math.max(1, Math.round(Number(sr.quantity || 1)));
  const grossTotal = Math.max(0, Math.round(Number(sr.unitPrice || 0) * qty));
  const netTotal = Math.max(0, Math.round(Number(sr.totalPrice || 0)));
  const directDiscountAmount = Math.max(0, grossTotal - netTotal);
  const unitNet = qty > 0 ? Math.round(netTotal / qty) : netTotal;

  const isCancelled = sr.status === 'CANCELLED' || sr.status === 'FAILED';
  const redeemedAmount = Math.max(0, netAmountRedeemed);
  const redeemedQuota = Math.max(0, netQuotaRedeemed);
  const quotaCoveredAmount = Math.min(netTotal, redeemedQuota * unitNet);
  const creditsApplied = isCancelled
    ? 0
    : Math.min(netTotal, redeemedAmount + quotaCoveredAmount);

  const rawAfterCredits = isCancelled ? 0 : Math.max(0, netTotal - creditsApplied);
  const cashPaid = isCancelled
    ? 0
    : options?.settledAtCheckoutByCash
      ? rawAfterCredits
      : Math.max(0, Math.round(Number((sr as any).cashPaid || 0)));
  const amountDue = isCancelled ? 0 : Math.max(0, rawAfterCredits - cashPaid);

  const settlementStatus: ServiceReceivableProjection['settlementStatus'] = isCancelled
    ? 'CANCELLED'
    : amountDue === 0
      ? options?.settledAtCheckoutByCash && rawAfterCredits > 0
        ? 'SETTLED_AT_CHECKOUT'
        : 'SETTLED_BY_BENEFIT'
      : creditsApplied > 0
        ? 'PARTIALLY_OFFSET'
        : 'UNPAID';

  return {
    serviceRequestId: String(sr.id),
    serviceId: String(sr.serviceId),
    serviceName: sr.serviceName,
    status: sr.status,
    quantity: qty,
    grossTotal,
    directDiscountAmount,
    netTotal,
    redeemedAmount,
    redeemedQuota,
    quotaCoveredAmount,
    creditsApplied,
    cashPaid,
    amountDue,
    remainingPayable: amountDue,
    settlementStatus,
  };
}
