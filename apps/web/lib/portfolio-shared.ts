export type BalanceRow = {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  minor: string;
  /** Currency minor-unit scale (0 for JPY, 2 for CAD/USD, …). */
  minorUnits: number;
};

export type PortfolioSnapshot = {
  householdId?: string;
  reportingCurrency?: string;
  ledgerVersion: number;
  balances: BalanceRow[];
  message?: string;
};

/**
 * Format ledger minors as a currency string using only string/bigint arithmetic
 * (never `Number(...)` on the money value).
 */
export function formatMoney(minor: string, currency: string, minorUnits = 2): string {
  const scale = Number.isInteger(minorUnits) && minorUnits >= 0 ? minorUnits : 2;
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).replace(/^0+(?=\d)/, "") || "0";

  let whole: string;
  let fraction: string;
  if (scale === 0) {
    whole = digits;
    fraction = "";
  } else if (digits.length <= scale) {
    whole = "0";
    fraction = digits.padStart(scale, "0");
  } else {
    whole = digits.slice(0, -scale);
    fraction = digits.slice(-scale);
  }

  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const absolute = scale > 0 ? `${wholeGrouped}.${fraction}` : wholeGrouped;
  const signedNumber = `${negative ? "-" : ""}${absolute}`;

  try {
    const currencySample = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    }).format(0);
    const numberSample = new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    }).format(0);

    if (!currencySample.includes(numberSample)) {
      return `${signedNumber} ${currency}`;
    }

    const withAmount = currencySample.replace(numberSample, absolute);
    if (negative) {
      // Keep a leading minus even when Intl's sample was unsigned zero.
      return withAmount.includes("-") ? withAmount : `-${withAmount}`;
    }
    return withAmount;
  } catch {
    return `${signedNumber} ${currency}`;
  }
}
