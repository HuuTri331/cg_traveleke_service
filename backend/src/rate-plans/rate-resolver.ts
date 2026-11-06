export interface NightRateInput {
  stayDates: string[];
  rates: Map<string, bigint>;
  quantity: number;
}

export interface NightRateResult {
  nightly: Array<{ date: string; amountVnd: bigint }>;
  totalVnd: bigint;
}

export function resolveBaseRate(input: NightRateInput): NightRateResult {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    throw Error('INVALID_QTY');
  }
  const nightly = input.stayDates.map((date) => {
    const unitRate = input.rates.get(date);
    if (unitRate === undefined) {
      throw Error(`RATE_MISSING:${date}`);
    }
    if (unitRate < 0n) {
      throw Error('NEGATIVE_RATE');
    }
    return { date, amountVnd: unitRate * BigInt(input.quantity) };
  });
  return {
    nightly,
    totalVnd: nightly.reduce((sum, row) => sum + row.amountVnd, 0n),
  };
}
