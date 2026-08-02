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

export { formatMoney } from "@/lib/format";
