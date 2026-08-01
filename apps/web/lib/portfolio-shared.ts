export type BalanceRow = {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  minor: string;
};

export type PortfolioSnapshot = {
  householdId?: string;
  reportingCurrency?: string;
  ledgerVersion: number;
  balances: BalanceRow[];
  message?: string;
};

export function formatMoney(minor: string, currency: string, minorUnits = 2): string {
  const negative = minor.startsWith("-");
  const digits = negative ? minor.slice(1) : minor;
  const padded = digits.padStart(minorUnits + 1, "0");
  const whole = padded.slice(0, -minorUnits) || "0";
  const fraction = padded.slice(-minorUnits);
  const amount = `${whole}.${fraction}`;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(Number(`${negative ? "-" : ""}${amount}`));
  } catch {
    return `${negative ? "-" : ""}${amount} ${currency}`;
  }
}
