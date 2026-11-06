import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export interface TaxFeePolicyRule {
  code: string;
  name: string;
  kind: 'TAX' | 'FEE';
  calcType: 'PERCENT' | 'PER_NIGHT' | 'PER_STAY' | 'PER_GUEST_PER_NIGHT';
  rateOrAmount: number;
  isInclusive?: boolean;
  appliesTo?: 'ROOM_ONLY' | 'SERVICE_ONLY' | 'ROOM_AND_SERVICE';
  compoundOrder?: number;
  policyVersion?: number;
}

export interface ImmutableChargeLine {
  kind: 'ROOM_BASE' | 'DISCOUNT' | 'VOUCHER_DISCOUNT' | 'SERVICE_CHARGE' | 'MANDATORY_FEE' | 'VAT_TAX';
  code: string;
  label: string;
  basisVnd: number;
  rate: number;
  amountVnd: number;
  currency: 'VND';
  policyVersion: number;
}

@Injectable()
export class PriceComponentsService {
  /**
   * Deterministic tax/fee calculation order (IMP-10 / GAP-10):
   * 1. Room nightly base total
   * 2. Eligible campaign discount + voucher discount (never below 0)
   * 3. Mandatory fees & service charge (compoundOrder = 1)
   * 4. VAT / compound tax on taxable basis (compoundOrder = 2)
   * 5. Final payable total in integer VND + SHA-256 quote hash
   */
  computeQuoteChargeBreakdown(params: {
    roomBaseTotalVnd: number;
    serviceBaseTotalVnd?: number;
    campaignDiscountVnd?: number;
    voucherDiscountVnd?: number;
    nightsCount: number;
    guestsCount?: number;
    quantity?: number;
    rules?: TaxFeePolicyRule[];
  }): {
    roomBaseTotalVnd: number;
    serviceBaseTotalVnd: number;
    totalDiscountVnd: number;
    netTaxableRoomAndServiceVnd: number;
    totalFeeVnd: number;
    totalTaxVnd: number;
    payableTotalVnd: number;
    chargeLines: ImmutableChargeLine[];
    priceHash: string;
  } {
    const roomBase = Math.round(Number(params.roomBaseTotalVnd || 0));
    const serviceBase = Math.round(Number(params.serviceBaseTotalVnd || 0));
    const grossSubtotal = roomBase + serviceBase;

    const campaignDisc = Math.min(grossSubtotal, Math.max(0, Math.round(Number(params.campaignDiscountVnd || 0))));
    const afterCampaign = grossSubtotal - campaignDisc;
    const voucherDisc = Math.min(afterCampaign, Math.max(0, Math.round(Number(params.voucherDiscountVnd || 0))));
    const totalDiscountVnd = campaignDisc + voucherDisc;
    const netSubtotal = Math.max(0, grossSubtotal - totalDiscountVnd);

    const chargeLines: ImmutableChargeLine[] = [
      {
        kind: 'ROOM_BASE',
        code: 'ROOM_SUBTOTAL',
        label: 'Tiền phòng tiêu chuẩn',
        basisVnd: roomBase,
        rate: 1,
        amountVnd: roomBase,
        currency: 'VND',
        policyVersion: 1,
      },
    ];

    if (campaignDisc > 0) {
      chargeLines.push({
        kind: 'DISCOUNT',
        code: 'CAMPAIGN_DISCOUNT',
        label: 'Khuyến mãi chương trình',
        basisVnd: grossSubtotal,
        rate: 0,
        amountVnd: -campaignDisc,
        currency: 'VND',
        policyVersion: 1,
      });
    }
    if (voucherDisc > 0) {
      chargeLines.push({
        kind: 'VOUCHER_DISCOUNT',
        code: 'VOUCHER_CODE',
        label: 'Mã giảm giá Voucher',
        basisVnd: afterCampaign,
        rate: 0,
        amountVnd: -voucherDisc,
        currency: 'VND',
        policyVersion: 1,
      });
    }

    const sortedRules = [...(params.rules || [])].sort(
      (a, b) => Number(a.compoundOrder ?? 1) - Number(b.compoundOrder ?? 1),
    );

    let runningTaxableBasis = netSubtotal;
    let totalFeeVnd = 0;
    let totalTaxVnd = 0;
    const nights = Math.max(1, Number(params.nightsCount || 1));
    const guests = Math.max(1, Number(params.guestsCount || 2));
    const roomsQty = Math.max(1, Number(params.quantity || 1));

    for (const rule of sortedRules) {
      if (rule.isInclusive) {
        continue;
      }
      let amount = 0;
      if (rule.calcType === 'PERCENT') {
        amount = Math.round((runningTaxableBasis * Number(rule.rateOrAmount)) / 100);
      } else if (rule.calcType === 'PER_NIGHT') {
        amount = Math.round(Number(rule.rateOrAmount) * nights * roomsQty);
      } else if (rule.calcType === 'PER_STAY') {
        amount = Math.round(Number(rule.rateOrAmount) * roomsQty);
      } else if (rule.calcType === 'PER_GUEST_PER_NIGHT') {
        amount = Math.round(Number(rule.rateOrAmount) * guests * nights);
      }

      if (rule.kind === 'FEE') {
        totalFeeVnd += amount;
        runningTaxableBasis += amount;
        chargeLines.push({
          kind: rule.code.includes('SERVICE') ? 'SERVICE_CHARGE' : 'MANDATORY_FEE',
          code: rule.code,
          label: rule.name,
          basisVnd: netSubtotal,
          rate: Number(rule.rateOrAmount),
          amountVnd: amount,
          currency: 'VND',
          policyVersion: Number(rule.policyVersion ?? 1),
        });
      } else {
        totalTaxVnd += amount;
        chargeLines.push({
          kind: 'VAT_TAX',
          code: rule.code,
          label: rule.name,
          basisVnd: runningTaxableBasis,
          rate: Number(rule.rateOrAmount),
          amountVnd: amount,
          currency: 'VND',
          policyVersion: Number(rule.policyVersion ?? 1),
        });
      }
    }

    const payableTotalVnd = Math.round(netSubtotal + totalFeeVnd + totalTaxVnd);
    const priceHash = createHash('sha256')
      .update(JSON.stringify({ chargeLines, payableTotalVnd }))
      .digest('hex');

    return {
      roomBaseTotalVnd: roomBase,
      serviceBaseTotalVnd: serviceBase,
      totalDiscountVnd,
      netTaxableRoomAndServiceVnd: netSubtotal,
      totalFeeVnd,
      totalTaxVnd,
      payableTotalVnd,
      chargeLines,
      priceHash,
    };
  }
}
