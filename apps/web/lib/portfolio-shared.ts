import type { AccountType } from "@stonks/ledger";

/**
 * Snapshot types shared between the server read model (`lib/portfolio.ts`,
 * `lib/portfolio-derive.ts`) and client components.
 *
 * Every money field is a **string of minor units** in the currency named
 * alongside it. Nothing here is a `number` money value, and nothing in this
 * module or the read model may call `Number(...)` on one — formatting is the
 * job of `lib/format.ts`, at render time.
 */

export type BalanceRow = {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  currency: string;
  /** Signed minor units, e.g. "-150000". */
  minor: string;
  /** Currency minor-unit scale (0 for JPY, 2 for CAD/USD, …). */
  minorUnits: number;
};

export type PositionRow = {
  /** `accountId:securityId`, the ledger's position key. */
  key: string;
  accountId: string;
  securityId: string;
  /**
   * Display symbol. There is no security master table yet, so the security
   * id is the symbol; when one lands this becomes a real lookup.
   */
  symbol: string;
  /** Fixed-scale (8 dp) decimal string, e.g. "150.00000000". */
  quantity: string;
  /** Currency the security trades in. */
  tradeCurrency: string;
  /**
   * Cost in the household reporting currency, minor units — or `null` when
   * the ledger holds no cost for this position. Never `"0"` as a stand-in:
   * check `costIsUnknown` before rendering.
   */
  costReportingMinor: string | null;
  /** Driven by the ledger's `isUnknownCost` on the position's cost state. */
  costIsUnknown: boolean;
};

/** Counts backing the open-items badge. Task 4 adds further categories. */
export type OpenItemCounts = {
  unknownCost: number;
  total: number;
};

export type PortfolioSnapshot = {
  householdId?: string | undefined;
  reportingCurrency?: string | undefined;
  ledgerVersion: number;
  balances: BalanceRow[];
  /** The same rows as `balances`, keyed by the ledger `AccountType` union. */
  balancesByType: Record<AccountType, BalanceRow[]>;
  positions: PositionRow[];
  /**
   * Reporting-currency totals, minor units.
   *
   * `netWorthMinor` sums every non-EXTERNAL account (EXTERNAL accounts model
   * the outside world, not household value). `totalBorrowedMinor` is the
   * negated sum of CREDIT_FACILITY balances, so a drawn facility reads as a
   * positive borrowed amount.
   */
  netWorthMinor: string;
  totalInvestedMinor: string;
  totalBorrowedMinor: string;
  /**
   * True when at least one balance is held in a currency other than the
   * reporting currency and no FX rate was available to convert it. Such
   * balances are excluded from the totals above; the flag exists so the UI
   * can say so instead of showing a number that quietly omits them.
   */
  totalsAreUncertain: boolean;
  openItemCounts: OpenItemCounts;
  message?: string | undefined;
};

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "INVESTMENT",
  "CREDIT_FACILITY",
  "RECEIVABLE",
  "CASH",
  "EXTERNAL",
];

export function emptyBalancesByType(): Record<AccountType, BalanceRow[]> {
  return {
    INVESTMENT: [],
    CREDIT_FACILITY: [],
    RECEIVABLE: [],
    CASH: [],
    EXTERNAL: [],
  };
}

/** A snapshot with nothing derived yet — no data, rather than fake data. */
export function emptyPortfolioSnapshot(
  fields: Pick<PortfolioSnapshot, "householdId" | "reportingCurrency" | "message"> = {},
): PortfolioSnapshot {
  return {
    ...fields,
    ledgerVersion: 0,
    balances: [],
    balancesByType: emptyBalancesByType(),
    positions: [],
    netWorthMinor: "0",
    totalInvestedMinor: "0",
    totalBorrowedMinor: "0",
    totalsAreUncertain: false,
    openItemCounts: { unknownCost: 0, total: 0 },
  };
}

export { formatMoney } from "@/lib/format";
