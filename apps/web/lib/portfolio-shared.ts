import type { AccountType, FacilityUse, TaxFlag } from "@stonks/ledger";
import type { PriceSource } from "@/lib/market/price-service";

export type { PriceSource };

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

  /**
   * Realized gains to date from this holding's dispositions, in the reporting
   * currency, minor units — summed from replay's own `RealizedGain` records.
   *
   * `null` when any disposition of this holding had an unknown cost basis
   * (the ledger records such a gain as zero by construction, so a sum would
   * understate); the reason is then in `realizedGainUncertaintyReason`. A
   * real `"0"` means no dispositions or break-even sales — a fact, not a
   * stand-in.
   */
  realizedGainReportingMinor: string | null;
  /** Why `realizedGainReportingMinor` is null; null when the figure is stated. */
  realizedGainUncertaintyReason: string | null;
  /** Journals whose dispositions produced the realized figure (traceable). */
  realizedSourceJournalIds: string[];

  /* --- Valuation. A field below is `null` when it is not derivable, with --- */
  /* --- the reason in `valuationUncertaintyReasons` — never a `"0"` that  --- */
  /* --- would read as a derived figure. A `"0"` that *is* there is a real --- */
  /* --- zero: no interest was attributed, no fee was charged.             --- */

  /** Where the mark came from. `NONE` means the holding is carried at cost. */
  priceSource: PriceSource;
  /** Resolved price per unit, minor units of `priceCurrency`. */
  priceMinor: string | null;
  /**
   * The currency the price is denominated in — the security's own trading
   * currency, which is what the price service resolves in. Usually equal to
   * `tradeCurrency`; it is carried separately because the two come from
   * different places (the security master vs. the posting) and a market value
   * is in the *price's* currency, whatever the posting said.
   */
  priceCurrency: string | null;
  /** Minor-unit scale of `priceCurrency`, for rendering `marketValueTradeMinor`. */
  priceMinorUnits: number | null;
  /** The date the price really belongs to, which may be before the valuation date. */
  priceAsOf: string | null;
  /** True when `priceAsOf` is older than the date valuation was asked for. */
  priceIsStale: boolean;

  /** Quantity x price, in `priceCurrency`, minor units. */
  marketValueTradeMinor: string | null;
  /** The same value in the reporting currency — `null` when no rate exists. */
  marketValueMinor: string | null;
  /** Reporting-currency market value less cost basis. */
  unrealizedGainMinor: string | null;
  /** Borrowing cost attributed to this holding by dollar-days, minor units. */
  interestCostMinor: string | null;
  /** Fees posted against this holding, minor units. Excludes portfolio-level fees. */
  feeCostMinor: string | null;
  /** Return before financing and costs: gain / cost, integer basis points. */
  grossReturnBps: number | null;
  /**
   * Return after the interest and fees attributable to **this holding**.
   *
   * Not the headline figure: a fee that names no holding cannot honestly be
   * split across holdings, so it is excluded here and counted only in
   * `PortfolioSnapshot.valuation.netReturnBps`, which is the figure that is
   * net of every cost. When that applies, `valuationUncertaintyReasons` says
   * so by amount.
   */
  netReturnBps: number | null;

  /** True when any figure above is missing, stale, or incomplete. */
  valuationIsUncertain: boolean;
  /** One human-readable reason per gap, naming what is missing and why. */
  valuationUncertaintyReasons: string[];
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
 * account metadata. Statement reconciliation needs imported statements and is
 * not invented here. Interest variance is derived on `BorrowingSummary` when
 * facility terms and a benchmark curve are supplied — it is not an open-item
 * kind, because the borrowing screen owns that presentation.
 */
export type OpenItemKind =
  | "UNKNOWN_COST_BASIS"
  | "ZERO_COST_BASIS"
  | "MISSING_FX_RATE";

/** One use bucket of a credit facility's current owed balance. */
export type FacilityUseRow = {
  use: FacilityUse;
  /** Owed amount attributed to this use, minor units of the facility currency. */
  owedMinor: string;
  /**
   * Share of the facility's total owed, integer basis points.
   * `null` when nothing is owed (no denominator), never a faked `0` share.
   */
  bps: number | null;
};

/**
 * Modelled (estimated) vs posted interest for a facility over a period.
 *
 * `modelled*` figures come from `modelInterest` and are always estimates —
 * `modelledIsEstimate` is `true` so a consumer cannot accidentally render them
 * as fact. `actualPostedMinor` is what the ledger really charged.
 */
export type FacilityInterestVariance = {
  periodStart: string;
  periodEnd: string;
  modelledTotalMinor: string;
  actualPostedMinor: string;
  /** Posted INTEREST_CHARGED journals included in actualPostedMinor. */
  actualJournalIds: string[];
  /** modelled − actual, minor units. */
  varianceMinor: string;
  modelledByUse: Partial<Record<FacilityUse, string>>;
  modelledIsEstimate: true;
};

/**
 * One month of interest for the interest-over-time chart.
 *
 * `modelledMinor` is an estimate (or `null` when terms/curve are missing).
 * `actualMinor` is the sum of posted `INTEREST_CHARGED` in that month — `"0"`
 * when none were posted is a real zero, not a stand-in.
 */
export type FacilityInterestPoint = {
  /** Calendar month, `YYYY-MM`. */
  month: string;
  modelledMinor: string | null;
  modelledIsEstimate: true;
  actualMinor: string;
};

/** One credit facility's borrowing picture, derived from replay (+ terms). */
export type FacilityBorrowing = {
  accountId: string;
  accountName: string;
  currency: string;
  minorUnits: number;
  /** Outstanding owed (positive), minor units of `currency`. */
  outstandingMinor: string;
  useBreakdown: FacilityUseRow[];
  /** INVESTMENT slice / total owed, integer bps — `null` when owed is zero. */
  investmentShareBps: number | null;
  /**
   * Benchmark + spread, annual rate in bps, as of the snapshot's `asOf`.
   * `null` when terms or a usable benchmark point are missing.
   */
  effectiveRateBps: number | null;
  /** Posted interest charged in the calendar year of `asOf`, minor units. */
  interestChargedYtdMinor: string;
  /** Posted interest journals included in interestChargedYtdMinor. */
  actualInterestJournalIds: string[];
  /**
   * INVESTMENT-use share of YTD posted interest, from facility-use attribution.
   * `null` when a charge in the year has no use attribution (unknown share).
   */
  investmentInterestYtdMinor: string | null;
  /** YTD modelled vs actual. `null` when modelling inputs are incomplete. */
  variance: FacilityInterestVariance | null;
  interestOverTime: FacilityInterestPoint[];
  /** Why a modelled/rate figure above is `null`. Incompleteness only. */
  uncertaintyReasons: string[];
};

/**
 * Household borrowing summary — the inputs for the borrowing screen.
 *
 * Household-level money fields are in the reporting currency and omit any
 * facility whose currency cannot be converted (same rule as `totalBorrowedMinor`).
 * `effectiveRateBps` is null when any facility that still has an outstanding
 * balance cannot report a rate — an average of the rest would understate.
 */
export type BorrowingSummary = {
  facilities: FacilityBorrowing[];
  outstandingMinor: string;
  outstandingIsUncertain: boolean;
  effectiveRateBps: number | null;
  interestChargedYtdMinor: string | null;
  investmentShareBps: number | null;
  uncertaintyReasons: string[];
};

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
  zeroCostBasis: number;
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
   * True when the year's figures do not mean what they appear to — an input
   * that could not be derived (an interest charge with no use attribution, a
   * realized gain with an unknown cost basis, an amount in a currency with no
   * rate), or a year outside the range the ledger covers at all, where the
   * zeroes record an absence of data rather than an absence of activity. A
   * quiet year *inside* the range is not uncertain: its zeroes are facts.
   */
  isUncertain: boolean;
  /** One human-readable reason per omission, naming the journal involved. */
  uncertaintyReasons: string[];
};

/**
 * The portfolio's valuation, and the product's headline number.
 *
 * The returns are **inception-to-date on cost**, not time-weighted or annualized:
 *
 *   gross = (marketValue - cost) * 10000 / cost
 *   net   = (marketValue - cost - interest - fees) * 10000 / cost
 *
 * `net` is the default figure to show; `gross` exists so the cost of borrowing
 * can be seen, and must never be labelled as net. Every field is `null` when
 * an input is missing, with the reason in `uncertaintyReasons` — a return
 * derived from a partial portfolio would read as fact.
 */
export type ValuationSummary = {
  /** Reporting-currency market value of every holding, minor units. */
  marketValueMinor: string | null;
  /** Pooled ACB across every holding, the denominator of both returns. */
  costBasisMinor: string | null;
  unrealizedGainMinor: string | null;
  /**
   * Investment-use interest charged over the ledger's whole span, minor units.
   * The portfolio figure is the charge itself, not a sum of attributions, so
   * it includes interest on holdings since sold.
   */
  interestCostMinor: string | null;
  /** Every fee posted in the reporting currency, whether or not attributable. */
  feeCostMinor: string | null;
  /** Integer basis points, before financing and costs. */
  grossReturnBps: number | null;
  /** Integer basis points, after interest and fees. Defaults to this. */
  netReturnBps: number | null;
  /** The date prices were asked for, or `null` when none were resolved. */
  pricedAsOf: string | null;
  /** True when at least one holding is marked at a price older than that date. */
  hasStalePrice: boolean;
  /**
   * True when a figure above is missing *or* is derived from a stale price —
   * the union of the two conditions below, for a caller that only needs to
   * know whether anything at all qualifies these numbers.
   */
  isUncertain: boolean;
  /**
   * Why a figure above is `null`. **Incompleteness only.**
   *
   * Staleness is deliberately not in here: a stale mark makes the return older
   * than today, not incomplete, and folding the two together would have every
   * weekend claim the headline figure was missing something when it is whole.
   * Read `staleReasons` for that, and never label the two the same way.
   */
  uncertaintyReasons: string[];
  /** One reason per holding marked at a price older than `pricedAsOf`. */
  staleReasons: string[];
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
   * Minor-unit scale of the reporting currency, or `null` when it could not
   * be established.
   *
   * Every household-level money field above is in the reporting currency, but
   * the per-balance `minorUnits` only covers currencies an account is held
   * in — and `AllocationRow.costReportingMinor` is a reporting-currency
   * amount that exists whether or not any *account* is denominated in it. A
   * guessed scale moves the decimal point, so this is `null` rather than a
   * default and the UI must render the `UNKNOWN` marker for such figures.
   */
  reportingMinorUnits: number | null;
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
  /** Market value, unrealized gain and returns. See `ValuationSummary`. */
  valuation: ValuationSummary;
  openItems: OpenItem[];
  openItemCounts: OpenItemCounts;
  /** `null` when there is no posted activity to summarize. */
  taxSummary: TaxSummary | null;
  /**
   * Credit-facility outstanding balances, use slices, YTD interest, and
   * modelled-vs-actual variance. Always present (possibly with an empty
   * `facilities` list) so the borrowing screen can distinguish "no facilities"
   * from "snapshot failed to load".
   */
  borrowing: BorrowingSummary;
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

/**
 * A valuation with nothing derived.
 *
 * Not uncertain: there is no portfolio here whose figures could be incomplete.
 * The `null`s say "nothing was derived", which is what an empty snapshot means.
 */
export function emptyValuation(): ValuationSummary {
  return {
    marketValueMinor: null,
    costBasisMinor: null,
    unrealizedGainMinor: null,
    interestCostMinor: null,
    feeCostMinor: null,
    grossReturnBps: null,
    netReturnBps: null,
    pricedAsOf: null,
    hasStalePrice: false,
    isUncertain: false,
    uncertaintyReasons: [],
    staleReasons: [],
  };
}

/** A borrowing summary with no credit facilities. */
export function emptyBorrowing(): BorrowingSummary {
  return {
    facilities: [],
    outstandingMinor: "0",
    outstandingIsUncertain: false,
    effectiveRateBps: null,
    interestChargedYtdMinor: "0",
    investmentShareBps: null,
    uncertaintyReasons: [],
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
    reportingMinorUnits: null,
    totalsAreUncertain: false,
    allocation: [],
    allocationBasis: "COST",
    allocationIsIncomplete: false,
    valueOverTime: [],
    valuation: emptyValuation(),
    openItems: [],
    openItemCounts: {
      unknownCost: 0,
      missingFxRate: 0,
      zeroCostBasis: 0,
      total: 0,
    },
    taxSummary: null,
    borrowing: emptyBorrowing(),
  };
}

export { formatMoney } from "@/lib/format";
