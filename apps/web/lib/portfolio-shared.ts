import type { AccountType, TaxFlag } from "@stonks/ledger";

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

/**
 * One position's share of the portfolio, in integer basis points.
 *
 * The shares are of **cost**, not market value: there is no price source
 * wired into the read model yet, so a market-value split cannot be derived
 * honestly. `PortfolioSnapshot.allocationBasis` names the basis so this can
 * never be read as a market-value split by mistake.
 */
export type AllocationRow = {
  /** `accountId:securityId`, the ledger's position key. */
  key: string;
  accountId: string;
  securityId: string;
  symbol: string;
  /** The weight this share was computed from: ACB cost, minor units. */
  costReportingMinor: string;
  /** Integer basis points. Across `allocation` these sum to exactly 10000. */
  bps: number;
};

/** What `allocation` divides up. Only cost is derivable today. */
export type AllocationBasis = "COST";

/** One month-end point of the value series. */
export type ValuePoint = {
  /** Calendar month, `YYYY-MM`. */
  month: string;
  /**
   * Reporting-currency net worth at that month end, minor units — derived by
   * replaying every journal up to the month end, not by accumulating deltas.
   */
  valueMinor: string;
  /**
   * True when a balance was excluded from this point for want of an FX rate,
   * exactly as `PortfolioSnapshot.totalsAreUncertain` does for the totals.
   */
  isUncertain: boolean;
};

/**
 * Data-quality findings the read model can derive from the ledger itself.
 *
 * The set is deliberately limited to kinds derivable from posted journals and
 * account metadata. Interest variance needs facility terms and a benchmark
 * rate curve, and statement reconciliation needs imported statements; neither
 * reaches the pure derivation, so neither is invented here.
 */
export type OpenItemKind = "UNKNOWN_COST_BASIS" | "MISSING_FX_RATE";

export type OpenItemSeverity = "INFO" | "WARNING" | "ERROR";

/** What an open item traces back to, so every finding stays auditable. */
export type OpenItemRefType = "POSITION" | "ACCOUNT" | "JOURNAL";

export type OpenItem = {
  kind: OpenItemKind;
  severity: OpenItemSeverity;
  message: string;
  refType: OpenItemRefType;
  /** Position key, account id or journal id, per `refType`. */
  refId: string;
};

/** Counts backing the open-items badge; `total` is `openItems.length`. */
export type OpenItemCounts = {
  unknownCost: number;
  missingFxRate: number;
  total: number;
};

/**
 * A Canadian tax-year summary, straight from the ledger's
 * `summarizeCanadaTaxYear` with its bigints rendered as minor-unit strings.
 *
 * `flags` is carried through unchanged: flags are informational and are never
 * silently applied to the figures above them.
 */
export type TaxSummary = {
  jurisdiction: "CA";
  year: number;
  realizedGainsMinor: string;
  realizedLossesMinor: string;
  taxableCapitalGainsMinor: string;
  inclusionRateBps: number;
  dividendIncomeMinor: string;
  interestIncomeMinor: string;
  deductibleInterestExpenseMinor: string;
  flags: TaxFlag[];
  disclaimer: string;
  /**
   * True when an input to the year could not be derived — an interest charge
   * with no use attribution, a realized gain with an unknown cost basis, or an
   * amount in a currency with no rate. The figures then omit that input rather
   * than guessing at it.
   */
  isUncertain: boolean;
  /** One human-readable reason per omission, naming the journal involved. */
  uncertaintyReasons: string[];
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
  /**
   * Per-position shares of **cost**, summing to exactly 10000 basis points.
   * Read `allocationBasis` before labelling this in the UI.
   */
  allocation: AllocationRow[];
  allocationBasis: AllocationBasis;
  /**
   * True when a position was left out of `allocation` because its cost is not
   * known. The remaining rows still sum to 10000, but they describe less than
   * the whole portfolio.
   */
  allocationIsIncomplete: boolean;
  /** Month-end net worth, oldest first, one point per calendar month. */
  valueOverTime: ValuePoint[];
  openItems: OpenItem[];
  openItemCounts: OpenItemCounts;
  /** `null` when there is no posted activity to summarize. */
  taxSummary: TaxSummary | null;
  message?: string | undefined;
};

/**
 * One empty bucket per `AccountType`. Written as an exhaustive literal so
 * that adding a member to the ledger's union is a compile error here rather
 * than a silently missing group.
 */
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
    allocation: [],
    allocationBasis: "COST",
    allocationIsIncomplete: false,
    valueOverTime: [],
    openItems: [],
    openItemCounts: { unknownCost: 0, missingFxRate: 0, total: 0 },
    taxSummary: null,
  };
}

export { formatMoney } from "@/lib/format";
