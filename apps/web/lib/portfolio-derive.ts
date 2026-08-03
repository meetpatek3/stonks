import {
  QUANTITY_SCALE,
  addCalendarDays,
  allocateExact,
  actualInterestCharged,
  attributeInvestmentInterest,
  FACILITY_USES,
  interestVariance,
  isUnknownCost,
  modelInterest,
  mulDivFloor,
  qtyFromDecimalString,
  qtyToDecimalString,
  rateBpsOnDate,
  replay,
  replayFacilitySlices,
  sortJournals,
  summarizeCanadaTaxYear,
  type Account,
  type AccountType,
  type BenchmarkRatePoint,
  type CanadaTaxYearArgs,
  type FacilityTerms,
  type FacilityUse,
  type Journal,
  type LedgerState,
  type RealizedGain,
} from "@stonks/ledger";
import { formatMoney } from "@/lib/format";
import type { ResolvedPrice } from "@/lib/market/price-service";
import {
  emptyBalancesByType,
  emptyBorrowing,
  emptyPortfolioSnapshot,
  type AllocationRow,
  type BalanceRow,
  type BorrowingSummary,
  type FacilityBorrowing,
  type FacilityInterestPoint,
  type FacilityInterestVariance,
  type FacilityUseRow,
  type OpenItem,
  type PortfolioSnapshot,
  type PositionRow,
  type TaxSummary,
  type ValuationSummary,
  type ValuePoint,
} from "@/lib/portfolio-shared";

/**
 * Pure derivation of the portfolio read model.
 *
 * Everything returned here is derived by replaying posted journals — no
 * stored snapshots, no hardcoded figures. This module deliberately knows
 * nothing about the database so it can be exercised with in-memory journals;
 * `lib/portfolio.ts` supplies the persistence.
 *
 * Money stays `bigint` internally and leaves as minor-unit strings via
 * `bigint.toString()` (which never produces `"-0"`). `Number(...)` on a money
 * value must not appear in this file.
 */

/** Account metadata the read model needs beyond the ledger's `Account`. */
export type AccountMeta = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Currency minor-unit scale (0 for JPY, 2 for CAD/USD, …). */
  minorUnits: number;
};

export type DerivePortfolioInput = {
  householdId?: string;
  reportingCurrency: string;
  accounts: readonly AccountMeta[];
  journals: readonly Journal[];
  /**
   * Minor-unit scale of the reporting currency, from the `currency` table.
   *
   * Optional so in-memory callers need not supply it. When omitted it is
   * inferred from an account denominated in the reporting currency —
   * `AccountMeta.minorUnits` comes from the same `currency` row, so the
   * inference cannot disagree with the table. With neither, the snapshot
   * carries `null` and the UI marks reporting-currency figures unknown
   * rather than rendering them at a guessed scale.
   */
  reportingMinorUnits?: number;
  /**
   * Tax year for `taxSummary`. Defaults to the year of the most recent posted
   * journal — the latest year the ledger actually has something to say about,
   * and unlike "this year" it does not go blank as the wall clock rolls into
   * a year with no activity yet.
   */
  taxYear?: number;
  /**
   * Resolved market prices, one per security, as data.
   *
   * Price resolution is asynchronous and does I/O; this derivation is neither,
   * and stays a pure function of its inputs so it can be exercised with
   * in-memory journals and a hand-written price list.
   * `lib/portfolio.ts` does the fetching. A security absent from this list is
   * treated exactly like one the service could not price: carried at cost,
   * with the gap stated.
   */
  prices?: readonly ResolvedPrice[];
  /**
   * Facility terms + benchmark curves, one entry per facility that has them.
   * A CREDIT_FACILITY account absent from this list still appears in
   * `borrowing.facilities` with use slices and actual interest, but modelled
   * interest, variance, and effective rate stay `null` with a stated reason.
   */
  facilityTerms?: readonly FacilityTermsInput[];
  /**
   * Cutoff date (`YYYY-MM-DD`) for YTD interest and the effective rate.
   * Defaults to the latest posted journal's trade date, so the pure derivation
   * does not depend on the wall clock. When there is no activity, YTD figures
   * are zero and rate lookup is skipped.
   */
  asOf?: string;
};

/** Terms + the benchmark curve the facility is priced off. */
export type FacilityTermsInput = {
  terms: FacilityTerms;
  benchmarkCurve: readonly BenchmarkRatePoint[];
};

/** Basis-point denominator: allocation shares always sum to this. */
const TOTAL_BPS = 10_000n;

/** `Quantity.scaled` is an integer at this many decimal places. */
const QUANTITY_SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/**
 * A position before valuation: what replay alone can say about a holding.
 *
 * Every field of it is also a field of `PositionRow`, so the valued row is the
 * same row with the derived figures filled in rather than a parallel shape.
 */
type PositionCore = Pick<
  PositionRow,
  | "key"
  | "accountId"
  | "securityId"
  | "symbol"
  | "quantity"
  | "tradeCurrency"
  | "costReportingMinor"
  | "costIsUnknown"
  | "realizedGainReportingMinor"
  | "realizedGainUncertaintyReason"
  | "realizedSourceJournalIds"
>;

export function derivePortfolioSnapshot(
  input: DerivePortfolioInput,
): PortfolioSnapshot {
  const { householdId, reportingCurrency, accounts, journals } = input;

  if (accounts.length === 0) {
    return emptyPortfolioSnapshot({
      householdId,
      reportingCurrency,
      message: "no accounts",
    });
  }

  const metaById = new Map(accounts.map((meta) => [meta.id, meta]));
  const ledgerAccounts = new Map<string, Account>(
    accounts.map((meta) => [
      meta.id,
      { id: meta.id, type: meta.type, currency: meta.currency },
    ]),
  );

  const state = replay(journals, ledgerAccounts, reportingCurrency);

  const balances: BalanceRow[] = [];
  for (const [accountId, balance] of state.balances) {
    const meta = metaById.get(accountId);
    if (!meta) {
      // replay's assertKnownAccounts makes this unreachable; fail loudly
      // rather than dropping money out of the totals.
      throw new Error(`Balance for account outside the household: ${accountId}`);
    }
    balances.push({
      accountId,
      accountName: meta.name,
      accountType: meta.type,
      currency: balance.currency,
      minor: balance.minor.toString(),
      minorUnits: meta.minorUnits,
    });
  }
  balances.sort((a, b) => a.accountName.localeCompare(b.accountName));

  const balancesByType = emptyBalancesByType();
  for (const row of balances) {
    balancesByType[row.accountType].push(row);
  }

  const totals = sumTotals(state, metaById, reportingCurrency);

  const core: PositionCore[] = [];
  const realizedByKey = new Map<string, RealizedGain[]>();
  for (const gain of state.realized) {
    const key = `${gain.accountId}:${gain.securityId}`;
    const list = realizedByKey.get(key) ?? [];
    list.push(gain);
    realizedByKey.set(key, list);
  }

  for (const [key, position] of state.positions) {
    const costUnknown = isUnknownCost(position.costState);
    core.push({
      key,
      accountId: position.accountId,
      securityId: position.securityId,
      symbol: position.securityId,
      quantity: qtyToDecimalString(position.quantity),
      tradeCurrency: position.tradeCurrency,
      costReportingMinor: costUnknown
        ? null
        : position.acbCostReportingMinor.toString(),
      costIsUnknown: costUnknown,
      ...summarizeRealized(key, position.securityId, realizedByKey.get(key) ?? []),
    });
  }
  core.sort((a, b) => a.key.localeCompare(b.key));

  const reportingMinorUnits =
    input.reportingMinorUnits ??
    accounts.find((meta) => meta.currency === reportingCurrency)?.minorUnits ??
    null;

  const { positions, valuation } = deriveValuation({
    core,
    prices: input.prices ?? [],
    journals,
    ledgerAccounts,
    reportingCurrency,
    reportingMinorUnits,
  });

  const { allocation, allocationIsIncomplete, zeroCost } =
    deriveAllocation(positions);
  const openItems = deriveOpenItems(
    positions,
    zeroCost,
    totals.unconvertible,
    metaById,
  );
  const countOf = (kind: OpenItem["kind"]) =>
    openItems.filter((item) => item.kind === kind).length;

  return {
    householdId,
    reportingCurrency,
    ledgerVersion: state.ledgerVersion,
    balances,
    balancesByType,
    positions,
    reportingMinorUnits,
    netWorthMinor: totals.netWorth.toString(),
    totalInvestedMinor: totals.invested.toString(),
    totalBorrowedMinor: totals.borrowed.toString(),
    totalsAreUncertain: totals.uncertain,
    allocation,
    allocationBasis: "COST",
    allocationIsIncomplete,
    valueOverTime: deriveValueOverTime(
      journals,
      ledgerAccounts,
      metaById,
      reportingCurrency,
    ),
    valuation,
    openItems,
    openItemCounts: {
      unknownCost: countOf("UNKNOWN_COST_BASIS"),
      missingFxRate: countOf("MISSING_FX_RATE"),
      zeroCostBasis: countOf("ZERO_COST_BASIS"),
      total: openItems.length,
    },
    taxSummary: deriveTaxSummary(
      state,
      journals,
      metaById,
      reportingCurrency,
      input.taxYear,
    ),
    borrowing: deriveBorrowing({
      accounts,
      journals,
      ledgerAccounts,
      reportingCurrency,
      facilityTerms: input.facilityTerms ?? [],
      ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
    }),
  };
}

type Totals = {
  netWorth: bigint;
  invested: bigint;
  borrowed: bigint;
  uncertain: boolean;
  /** Accounts dropped from the totals for want of an FX rate. */
  unconvertible: string[];
};

/**
 * Reporting-currency totals over a replayed state.
 *
 * Shared by the headline totals and by every point of `valueOverTime`, so a
 * month-end value is the same computation as the current net worth rather
 * than a parallel one that could drift from it.
 */
function sumTotals(
  state: LedgerState,
  metaById: ReadonlyMap<string, AccountMeta>,
  reportingCurrency: string,
): Totals {
  let netWorth = 0n;
  let invested = 0n;
  let borrowed = 0n;
  const unconvertible: string[] = [];

  for (const [accountId, balance] of state.balances) {
    const type = metaById.get(accountId)?.type;

    // EXTERNAL accounts model the outside world, so they never contribute to
    // any total. Skip them before the currency test: dropping one loses
    // nothing, and flagging uncertainty for it would claim the totals are
    // incomplete when they are not.
    if (type === "EXTERNAL") {
      continue;
    }

    if (balance.currency !== reportingCurrency) {
      // No FX rate available to state this in the reporting currency, so it
      // is excluded from the totals and the uncertainty is flagged instead.
      unconvertible.push(accountId);
      continue;
    }

    netWorth += balance.minor;
    if (type === "INVESTMENT") {
      invested += balance.minor;
    } else if (type === "CREDIT_FACILITY") {
      borrowed -= balance.minor;
    }
  }

  unconvertible.sort();
  return {
    netWorth,
    invested,
    borrowed,
    uncertain: unconvertible.length > 0,
    unconvertible,
  };
}

/**
 * Per-position shares of pooled ACB cost, in basis points summing to exactly
 * 10000.
 *
 * These are shares of **cost**, not of market value: nothing reaching this
 * function carries a price, so a market-value split cannot be derived
 * honestly. `allocateExact` distributes the rounding remainder (Hamilton
 * largest remainder), so the parts sum exactly instead of drifting.
 *
 * Two kinds of position carry no honest weight and are omitted: one whose cost
 * is unknown, and one whose cost is known to be zero (a gift or a zero-basis
 * spinoff). Both set `allocationIsIncomplete`, and both are returned so the
 * caller can raise a *traceable* open item naming the holding rather than
 * leaving the UI with only a boolean.
 */
function deriveAllocation(positions: readonly PositionCore[]): {
  allocation: AllocationRow[];
  allocationIsIncomplete: boolean;
  /** Positions with a known but non-positive cost, excluded from the split. */
  zeroCost: PositionCore[];
} {
  const weighted: { position: PositionCore; cost: bigint }[] = [];
  const zeroCost: PositionCore[] = [];
  let omitted = false;

  for (const position of positions) {
    if (position.costIsUnknown || position.costReportingMinor === null) {
      omitted = true;
      continue;
    }
    const cost = BigInt(position.costReportingMinor);
    if (cost <= 0n) {
      // A zero or negative pooled cost has no share of a positive whole, and
      // allocateExact rejects such a weight outright.
      omitted = true;
      zeroCost.push(position);
      continue;
    }
    weighted.push({ position, cost });
  }

  if (weighted.length === 0) {
    // Nothing to divide. With no positions at all this is not "incomplete" —
    // there is simply nothing to show.
    return { allocation: [], allocationIsIncomplete: omitted, zeroCost };
  }

  const parts = allocateExact(
    TOTAL_BPS,
    weighted.map((entry) => entry.cost),
  );

  const allocation = weighted.map((entry, index) => ({
    key: entry.position.key,
    accountId: entry.position.accountId,
    securityId: entry.position.securityId,
    symbol: entry.position.symbol,
    costReportingMinor: entry.cost.toString(),
    // A share, not money: bounded by 10000, so a JS number is exact here.
    // Money never becomes a number in this file.
    bps: Number(parts[index]),
  }));

  return { allocation, allocationIsIncomplete: omitted, zeroCost };
}

/**
 * One holding's realized gains to date, summed from replay's disposition
 * records.
 *
 * The sum is stated only when every disposition of the holding had a known
 * cost basis: the ledger records an unknown-cost disposition's gain as zero
 * by construction, so summing across a mix would understate without saying
 * so. One unknown-cost sale nulls the figure with a reason; the source
 * journals stay listed either way, so the answer remains traceable.
 */
function summarizeRealized(
  key: string,
  symbol: string,
  gains: readonly RealizedGain[],
): Pick<
  PositionRow,
  | "realizedGainReportingMinor"
  | "realizedGainUncertaintyReason"
  | "realizedSourceJournalIds"
> {
  const sourceJournalIds = [
    ...new Set(gains.flatMap((gain) => gain.sourceJournalIds)),
  ].sort();

  if (gains.some((gain) => isUnknownCost(gain.costState))) {
    return {
      realizedGainReportingMinor: null,
      realizedGainUncertaintyReason:
        `${symbol} was sold with no recorded cost basis, so the realized gain ` +
        `to date on ${key} cannot be stated.`,
      realizedSourceJournalIds: sourceJournalIds,
    };
  }

  let total = 0n;
  for (const gain of gains) {
    total += gain.gainReportingMinor;
  }
  return {
    realizedGainReportingMinor: total.toString(),
    realizedGainUncertaintyReason: null,
    realizedSourceJournalIds: sourceJournalIds,
  };
}

/* ------------------------------------------------------------------ */
/* Valuation                                                           */
/* ------------------------------------------------------------------ */

/**
 * Market value, unrealized gain, and returns gross and net of borrowing cost.
 *
 * **The formulas.** Both returns are inception-to-date on the holding's own
 * pooled cost — not time-weighted, not annualized, and not a period return
 * (this ledger has one price per security, for one date, so a period return
 * has no earlier mark to measure against):
 *
 *     unrealizedGain = marketValue - cost
 *     grossReturnBps = unrealizedGain                        * 10000 / cost
 *     netReturnBps   = (unrealizedGain - interest - fees)    * 10000 / cost
 *
 * Gross is before financing and costs; net is after the interest attributed to
 * the holding by dollar-days and the fees posted against it. `netReturnBps` is
 * computed from the raw numerator rather than by adjusting `grossReturnBps`,
 * so the two do not compound a rounding step.
 *
 * **The uncertainty rule.** Anything not derivable is `null` with a reason,
 * never `0`. No price, no FX rate for the price's currency, an unknown cost
 * basis, a zero cost basis, or an interest charge that cannot be attributed
 * each null out exactly the figures that depend on them and leave the rest
 * standing — an unknowable financing cost removes the net return but not the
 * gross one.
 *
 * A **stale** price is the one input that does not null anything out. It is a
 * real price for a real date, just not for today's, so the figures are derived
 * and `priceAsOf` / `priceIsStale` travel with every one of them.
 */
function deriveValuation(args: {
  core: readonly PositionCore[];
  prices: readonly ResolvedPrice[];
  journals: readonly Journal[];
  ledgerAccounts: ReadonlyMap<string, Account>;
  reportingCurrency: string;
  reportingMinorUnits: number | null;
}): { positions: PositionRow[]; valuation: ValuationSummary } {
  const { core, prices, journals, ledgerAccounts } = args;
  const { reportingCurrency, reportingMinorUnits } = args;

  const priceBySecurity = new Map(prices.map((price) => [price.securityId, price]));
  const heldKeys = new Set(core.map((position) => position.key));
  const interest = attributeInterest(journals, ledgerAccounts, reportingCurrency, heldKeys);
  const fees = sumFees(journals, ledgerAccounts, reportingCurrency);
  const describe = (minor: bigint) =>
    describeMoney(minor, reportingCurrency, reportingMinorUnits);

  const positions: PositionRow[] = [];
  /** Reasons that also make a *portfolio* figure incomplete. */
  const sharedReasons: string[] = [];
  /** Staleness, kept apart: it dates a figure, it does not leave one out. */
  const staleReasons: string[] = [];

  for (const position of core) {
    const local: string[] = [];
    const shared: string[] = [];
    const stale: string[] = [];
    const resolved = priceBySecurity.get(position.securityId);
    const mark = usableMark(resolved);

    if (mark === undefined) {
      shared.push(
        isNegativePrice(resolved)
          ? `The recorded price for ${position.symbol} is negative, so it is not a ` +
              `usable mark and the holding is carried at cost.`
          : `No price is available for ${position.symbol}, so it is carried at cost ` +
              `and no return on it can be stated.`,
      );
    } else if (mark.stale) {
      stale.push(
        `${position.symbol} is marked at its ${mark.asOf} price, not at a price ` +
          `for ${mark.requestedAsOf}; every figure derived from it is as of that ` +
          `earlier date.`,
      );
    }

    // `mulDivFloor` throws on a negative operand, and is safe here only
    // because both are guaranteed non-negative: `usableMark` refuses a
    // negative price, and `applyPostingQuantities` refuses a negative
    // quantity outright, so a holding cannot be short. Floored to whole minor
    // units, the direction the ledger's own cost allocation rounds.
    const marketValueTrade =
      mark === undefined
        ? null
        : mulDivFloor(
            qtyFromDecimalString(position.quantity).scaled,
            mark.priceMinor,
            QUANTITY_SCALE_FACTOR,
          );

    // `replay` converts no FX and neither does this: with the price in another
    // currency and no rate, the reporting-currency value is unknown, not
    // approximate. Today the only rate this read model has is the identity
    // one, so conversion happens exactly when the currencies already agree.
    let marketValue: bigint | null = null;
    if (marketValueTrade !== null && mark !== undefined) {
      if (mark.currency === reportingCurrency) {
        marketValue = marketValueTrade;
      } else {
        shared.push(
          `${position.symbol} is priced in ${mark.currency} and no rate is ` +
            `available to state that in ${reportingCurrency}, so its market value ` +
            `and return are excluded.`,
        );
      }
    }

    const cost =
      position.costReportingMinor === null ? null : BigInt(position.costReportingMinor);

    if (cost === null) {
      shared.push(
        `No cost basis is recorded for ${position.symbol}, so its gain and return ` +
          `cannot be derived from its market value.`,
      );
    } else if (cost <= 0n && marketValue !== null) {
      // A gift or zero-basis spinoff: the gain is real, the return is not a
      // number. Local, because the portfolio usually has other holdings to
      // divide by — where it does not, `summarizeValuation` raises its own
      // reason rather than leaving the portfolio return null and unexplained.
      local.push(
        `${position.symbol} has a recorded cost of zero or less, so it has no ` +
          `basis to state a return on even though its gain is known.`,
      );
    }

    const gain = marketValue !== null && cost !== null ? marketValue - cost : null;
    const interestCost = interest.byKey === null ? null : (interest.byKey.get(position.key) ?? 0n);
    const feeCost = fees.byKey === null ? null : (fees.byKey.get(position.key) ?? 0n);

    if (interest.byKey === null) shared.push(...interest.blockingReasons);
    if (fees.byKey === null) shared.push(...fees.blockingReasons);

    if (fees.byKey !== null && fees.unattributedMinor > 0n) {
      local.push(
        `Fees of ${describe(fees.unattributedMinor)} name no holding, so they are ` +
          `excluded from this holding's net return and counted only across the ` +
          `portfolio.`,
      );
    }

    const netNumerator =
      gain !== null && interestCost !== null && feeCost !== null
        ? gain - interestCost - feeCost
        : null;

    // The row itself is qualified by all three: a holding marked at an old
    // price *is* uncertain, even though the portfolio total it feeds is whole.
    const reasons = [...shared, ...local, ...stale];
    sharedReasons.push(...shared);
    staleReasons.push(...stale);

    positions.push({
      ...position,
      priceSource: mark?.source ?? "NONE",
      priceMinor: mark?.priceMinor.toString() ?? null,
      priceCurrency: mark?.currency ?? null,
      priceMinorUnits: mark?.minorUnits ?? null,
      priceAsOf: mark?.asOf ?? null,
      priceIsStale: mark?.stale ?? false,
      marketValueTradeMinor: marketValueTrade?.toString() ?? null,
      marketValueMinor: marketValue?.toString() ?? null,
      unrealizedGainMinor: gain?.toString() ?? null,
      interestCostMinor: interestCost?.toString() ?? null,
      feeCostMinor: feeCost?.toString() ?? null,
      grossReturnBps: gain === null || cost === null ? null : returnBps(gain, cost),
      netReturnBps:
        netNumerator === null || cost === null ? null : returnBps(netNumerator, cost),
      valuationIsUncertain: reasons.length > 0,
      valuationUncertaintyReasons: reasons,
    });
  }

  return {
    positions,
    valuation: summarizeValuation({
      positions,
      sharedReasons,
      staleReasons,
      interest,
      fees,
      describe,
      pricedAsOf: valuationDate(prices, core),
    }),
  };
}

/**
 * The portfolio's own figures.
 *
 * A total is stated only when every holding contributes to it: a market value
 * that quietly omitted an unpriced holding would understate the portfolio, and
 * a return computed over part of it would read as a return over all of it.
 * Interest and fees are the *charges themselves*, not sums of attributions, so
 * the headline is net of every cost even where the per-holding split is not
 * derivable.
 */
function summarizeValuation(args: {
  positions: readonly PositionRow[];
  sharedReasons: readonly string[];
  staleReasons: readonly string[];
  interest: InterestAttribution;
  fees: FeeAttribution;
  describe: (minor: bigint) => string;
  pricedAsOf: string | null;
}): ValuationSummary {
  const { positions, sharedReasons, interest, fees, describe, pricedAsOf } = args;

  const reasons = [...new Set(sharedReasons)];

  let marketValue: bigint | null = 0n;
  let cost: bigint | null = 0n;
  for (const position of positions) {
    if (position.marketValueMinor === null) marketValue = null;
    else if (marketValue !== null) marketValue += BigInt(position.marketValueMinor);

    if (position.costReportingMinor === null) cost = null;
    else if (cost !== null) cost += BigInt(position.costReportingMinor);
  }

  if (positions.length === 0) {
    reasons.push(
      "There are no holdings, so there is no cost basis to state a return on.",
    );
  } else if (cost !== null && cost <= 0n) {
    // Every holding is a gift or a zero-basis spinoff. `returnBps` refuses the
    // division, and without this the portfolio return would be `null` with
    // nothing on the page saying why — the per-holding reason for this is
    // deliberately local, and there is no *other* holding to carry a shared one.
    reasons.push(
      `The portfolio's whole cost basis is ${describe(cost)}, so there is no ` +
        `basis to state a return on even though the holdings and their gain are ` +
        `real.`,
    );
  }

  if (interest.strandedMinor > 0n) {
    reasons.push(
      `Some interest is attributed to a holding no longer held. The portfolio ` +
        `figure includes it; the per-holding figures do not.`,
    );
  }

  const gain = marketValue !== null && cost !== null ? marketValue - cost : null;
  const netNumerator =
    gain !== null && interest.totalMinor !== null && fees.totalMinor !== null
      ? gain - interest.totalMinor - fees.totalMinor
      : null;

  const hasStalePrice = positions.some((position) => position.priceIsStale);

  return {
    marketValueMinor: marketValue?.toString() ?? null,
    costBasisMinor: cost?.toString() ?? null,
    unrealizedGainMinor: gain?.toString() ?? null,
    interestCostMinor: interest.totalMinor?.toString() ?? null,
    feeCostMinor: fees.totalMinor?.toString() ?? null,
    grossReturnBps: gain === null || cost === null ? null : returnBps(gain, cost),
    netReturnBps:
      netNumerator === null || cost === null ? null : returnBps(netNumerator, cost),
    pricedAsOf,
    hasStalePrice,
    isUncertain: reasons.length > 0 || hasStalePrice,
    uncertaintyReasons: reasons,
    staleReasons: [...new Set(args.staleReasons)],
  };
}

/**
 * The date the portfolio is valued at.
 *
 * Taken from the prices for securities the household actually **holds** — an
 * entry for anything else says nothing about this portfolio — and, where those
 * disagree, the *earliest* of them: a set of figures is only as current as its
 * oldest input. Reading `prices[0]` instead would make the answer depend on
 * the order the caller happened to build its array in.
 */
function valuationDate(
  prices: readonly ResolvedPrice[],
  core: readonly PositionCore[],
): string | null {
  const held = new Set(core.map((position) => position.securityId));
  const dates = prices
    .filter((price) => held.has(price.securityId))
    .map((price) => price.requestedAsOf)
    .sort();
  return dates[0] ?? null;
}

/** A resolved price narrowed to one that can actually serve as a mark. */
type UsableMark = Omit<ResolvedPrice, "priceMinor"> & { priceMinor: bigint };

/**
 * The mark a holding can be valued at, or `undefined` when there is none.
 *
 * `NONE` means the service found no price at all. A negative price cannot
 * arise legitimately, and accepting one would turn a bad row into a negative
 * market value that reads as derived — so it is refused here, where the
 * refusal can be stated, rather than propagated. Narrowing in one place is
 * also what lets every figure downstream be computed without a non-null
 * assertion on `priceMinor`.
 */
function usableMark(price: ResolvedPrice | undefined): UsableMark | undefined {
  if (price === undefined || price.source === "NONE") return undefined;
  if (price.priceMinor === null || price.priceMinor < 0n) return undefined;
  return { ...price, priceMinor: price.priceMinor };
}

/** Distinguishes "no price" from "a price that cannot be used", for the reason text. */
function isNegativePrice(price: ResolvedPrice | undefined): boolean {
  return price?.priceMinor != null && price.priceMinor < 0n;
}

/**
 * A return in integer basis points, or `null` when there is no denominator to
 * divide by.
 *
 * Basis points are a ratio, not money, and are bounded by the portfolio's own
 * scale, so the `Number` conversion here is exact and is not the forbidden
 * money→number one. `bigint` division truncates toward zero, so a gain and a
 * loss of the same size round symmetrically rather than drifting apart.
 */
function returnBps(gain: bigint, cost: bigint): number | null {
  if (cost <= 0n) return null;
  return Number((gain * TOTAL_BPS) / cost);
}

type InterestAttribution = {
  /** Investment interest per position key, or `null` when not derivable. */
  byKey: Map<string, bigint> | null;
  /** The household's whole investment-use interest charge, or `null`. */
  totalMinor: bigint | null;
  /** Attributed to holdings no longer held, so carried by no row. */
  strandedMinor: bigint;
  /** Why nothing could be attributed. Empty unless `byKey` is `null`. */
  blockingReasons: string[];
};

/**
 * Borrowing cost per holding, from the ledger's own dollar-days attribution.
 *
 * Only the INVESTMENT share of a charge is a cost of investing, and that share
 * is knowable only from the facility-use attribution a draw carries. Interest
 * with no such attribution is not "zero investment interest" — it is an
 * unknown amount of it, so nothing is attributed at all and every net return
 * goes `null` rather than being quietly understated.
 */
function attributeInterest(
  journals: readonly Journal[],
  ledgerAccounts: ReadonlyMap<string, Account>,
  reportingCurrency: string,
  heldKeys: ReadonlySet<string>,
): InterestAttribution {
  const posted = sortJournals(journals);
  const blockingReasons: string[] = [];
  let total = 0n;

  for (const journal of posted) {
    if (journal.type !== "INTEREST_CHARGED") continue;

    if (!journal.facilityUses || journal.facilityUses.length === 0) {
      blockingReasons.push(
        `${journal.id}: interest was charged with no facility-use attribution, so ` +
          `how much of it financed investing is not derivable and no return can be ` +
          `stated net of it.`,
      );
      continue;
    }
    for (const line of journal.facilityUses) {
      if (line.use !== "INVESTMENT") continue;
      if (line.amount.currency !== reportingCurrency) {
        blockingReasons.push(
          `${journal.id}: interest is in ${line.amount.currency} and no rate is ` +
            `available to state it in ${reportingCurrency}, so it cannot be counted ` +
            `as a cost.`,
        );
        continue;
      }
      total += line.amount.minor;
    }
  }

  if (blockingReasons.length > 0) {
    return { byKey: null, totalMinor: null, strandedMinor: 0n, blockingReasons };
  }

  const first = posted[0];
  const last = posted[posted.length - 1];
  if (total === 0n || !first || !last) {
    // No investment interest is a fact, not a gap: every holding's borrowing
    // cost really is zero.
    return { byKey: new Map(), totalMinor: 0n, strandedMinor: 0n, blockingReasons };
  }

  // PERFORMANCE: `attributeInvestmentInterest` replays full position state
  // once per calendar day of the ledger's span — O(days x journals), so a
  // five-year ledger costs roughly 1,800 replays per uncached snapshot. It is
  // reached only when investment interest is non-zero, and
  // `getPortfolioSnapshot` is `React.cache`-wrapped so it runs once per
  // request. The fix is an incremental dollar-days accumulator in
  // `packages/ledger`; this is the most expensive thing in the read model.
  const { allocations, unallocatedMinor } = attributeInvestmentInterest({
    journals: posted,
    accounts: ledgerAccounts,
    // Inclusive of the last day of activity: the attribution's period is
    // half-open, so the end is the day after it.
    periodStart: first.tradeDate,
    periodEnd: addCalendarDays(last.tradeDate, 1),
    investmentInterestMinor: total,
  });

  const byKey = new Map<string, bigint>();
  let stranded = unallocatedMinor;
  for (const allocation of allocations) {
    const key = `${allocation.accountId}:${allocation.securityId}`;
    if (heldKeys.has(key)) byKey.set(key, allocation.interestMinor);
    else stranded += allocation.interestMinor;
  }

  return { byKey, totalMinor: total, strandedMinor: stranded, blockingReasons };
}

type FeeAttribution = {
  /** Fees per position key, or `null` when a fee is not derivable at all. */
  byKey: Map<string, bigint> | null;
  /** Every *investment* fee in the reporting currency, or `null`. See `sumFees`. */
  totalMinor: bigint | null;
  /** The share of `totalMinor` that names no holding. */
  unattributedMinor: bigint;
  blockingReasons: string[];
};

/**
 * **Investment** fees, and the share of them that belongs to a named holding.
 *
 * Three filters, each doing what it says:
 *
 * 1. **A cost of investing, not of banking.** A chequing account's monthly
 *    maintenance fee is a real cost, but it is not a cost of the investment
 *    programme and subtracting it would understate the return on the
 *    portfolio. Counted only on an INVESTMENT account, or on any household
 *    account when the leg names a security — a commission settled out of cash
 *    is an investment cost wherever it was paid from.
 * 2. **A household leg, not the counterparty's.** The EXTERNAL leg is whoever
 *    charged the fee. Without this test a *rebate* — money coming back, so the
 *    negative leg is the EXTERNAL one — would be counted as a second cost.
 * 3. **An outflow.** The positive leg of a charge is the receiver, not a
 *    second fee. Checked before the currency test so one foreign-currency
 *    charge raises one reason rather than one per leg.
 *
 * A leg that names a security belongs to that holding; an account-level
 * investment fee belongs to no single holding, and is counted across the
 * portfolio rather than spread over holdings by a rule the ledger never stated.
 */
function sumFees(
  journals: readonly Journal[],
  ledgerAccounts: ReadonlyMap<string, Account>,
  reportingCurrency: string,
): FeeAttribution {
  const byKey = new Map<string, bigint>();
  const blockingReasons: string[] = [];
  let total = 0n;
  let attributed = 0n;

  for (const journal of sortJournals(journals)) {
    if (journal.type !== "FEE") continue;

    for (const posting of journal.postings) {
      if (posting.amount.minor >= 0n) continue;

      const accountType = ledgerAccounts.get(posting.accountId)?.type;
      if (accountType === undefined || accountType === "EXTERNAL") continue;
      if (accountType !== "INVESTMENT" && posting.securityId === undefined) continue;

      if (posting.amount.currency !== reportingCurrency) {
        blockingReasons.push(
          `${journal.id}: the fee is in ${posting.amount.currency} and no rate is ` +
            `available to state it in ${reportingCurrency}, so it cannot be counted ` +
            `as a cost.`,
        );
        continue;
      }
      const cost = -posting.amount.minor;
      total += cost;
      if (posting.securityId !== undefined) {
        const key = `${posting.accountId}:${posting.securityId}`;
        byKey.set(key, (byKey.get(key) ?? 0n) + cost);
        attributed += cost;
      }
    }
  }

  if (blockingReasons.length > 0) {
    return { byKey: null, totalMinor: null, unattributedMinor: 0n, blockingReasons };
  }

  return {
    byKey,
    totalMinor: total,
    unattributedMinor: total - attributed,
    blockingReasons,
  };
}

/**
 * An amount inside a sentence.
 *
 * A reason has to name the money it is about, and the reporting currency's
 * scale can be unknown — in which case the amount is stated in minor units
 * rather than at a guessed decimal point, which would state a different number.
 */
function describeMoney(
  minor: bigint,
  currency: string,
  minorUnits: number | null,
): string {
  return minorUnits === null
    ? `${minor.toString()} minor units of ${currency}`
    : formatMoney(minor.toString(), currency, minorUnits);
}

/**
 * The securities the household still holds, so a price is never fetched for a
 * holding it has sold out of.
 *
 * Quantities net to zero exactly when a position is closed (`replay` rejects a
 * negative quantity outright, so a holding cannot go short and net back to
 * zero while still existing). This is a cheap scan rather than a second
 * replay, because its caller needs the list *before* it can resolve the prices
 * that the replayed snapshot then consumes.
 */
export function heldSecurityIds(journals: readonly Journal[]): string[] {
  const scaledBySecurity = new Map<string, bigint>();

  for (const journal of sortJournals(journals)) {
    for (const posting of journal.postings) {
      if (posting.securityId === undefined || posting.quantity === undefined) continue;
      const current = scaledBySecurity.get(posting.securityId) ?? 0n;
      scaledBySecurity.set(posting.securityId, current + posting.quantity.scaled);
    }
  }

  return [...scaledBySecurity.entries()]
    .filter(([, scaled]) => scaled !== 0n)
    .map(([securityId]) => securityId)
    .sort();
}

/**
 * Month-end reporting-currency net worth, oldest first.
 *
 * Each point is a full replay of every journal posted up to that month end,
 * so any point can be re-derived from the ledger on its own instead of
 * depending on a running figure. A month with no journals therefore repeats
 * the previous month's value naturally, rather than being patched in.
 */
function deriveValueOverTime(
  journals: readonly Journal[],
  ledgerAccounts: ReadonlyMap<string, Account>,
  metaById: ReadonlyMap<string, AccountMeta>,
  reportingCurrency: string,
): ValuePoint[] {
  const posted = sortJournals(journals);
  const first = posted[0];
  const last = posted[posted.length - 1];
  if (!first || !last) {
    return [];
  }

  const lastMonth = monthOf(last.tradeDate);
  const points: ValuePoint[] = [];

  for (
    let month = monthOf(first.tradeDate);
    month <= lastMonth;
    month = nextMonth(month)
  ) {
    const upTo = posted.filter((journal) => monthOf(journal.tradeDate) <= month);
    const totals = sumTotals(
      replay(upTo, ledgerAccounts, reportingCurrency),
      metaById,
      reportingCurrency,
    );
    points.push({
      month,
      valueMinor: totals.netWorth.toString(),
      isUncertain: totals.uncertain,
    });
  }

  return points;
}

/** `YYYY-MM` of an ISO `YYYY-MM-DD` trade date. */
function monthOf(tradeDate: string): string {
  return tradeDate.slice(0, 7);
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12
    ? `${year + 1}-01`
    : `${year}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * Data-quality findings, each traced to the position or account it came from.
 *
 * Only kinds derivable from posted journals and account metadata appear here.
 * Interest variance needs facility terms and a benchmark rate curve, and
 * statement reconciliation needs imported statements; neither is an input to
 * this function, so neither is guessed at.
 */
function deriveOpenItems(
  positions: readonly PositionCore[],
  zeroCostPositions: readonly PositionCore[],
  unconvertibleAccountIds: readonly string[],
  metaById: ReadonlyMap<string, AccountMeta>,
): OpenItem[] {
  const items: OpenItem[] = [];

  for (const position of positions) {
    if (!position.costIsUnknown) continue;
    items.push({
      kind: "UNKNOWN_COST_BASIS",
      severity: "WARNING",
      message:
        `No cost basis recorded for ${position.symbol}. Gains on a sale cannot ` +
        `be computed until an opening cost is entered.`,
      refType: "POSITION",
      refId: position.key,
    });
  }

  for (const position of zeroCostPositions) {
    // Not a data error — a gift or zero-basis spinoff really does cost
    // nothing. It is INFO because the only consequence is that the holding
    // carries no share of a cost-based split, which is worth naming.
    items.push({
      kind: "ZERO_COST_BASIS",
      severity: "INFO",
      message:
        `${position.symbol} has a recorded cost of zero, so it carries no share ` +
        `of the cost allocation even though the holding is real.`,
      refType: "POSITION",
      refId: position.key,
    });
  }

  for (const accountId of unconvertibleAccountIds) {
    const meta = metaById.get(accountId);
    items.push({
      kind: "MISSING_FX_RATE",
      severity: "WARNING",
      message:
        `${meta?.name ?? accountId} is held in ${meta?.currency ?? "another currency"} ` +
        `and no rate is available, so it is excluded from the totals.`,
      refType: "ACCOUNT",
      refId: accountId,
    });
  }

  return items;
}

/**
 * Canadian tax-year summary for `taxYear`, defaulting to the year of the most
 * recent posted journal.
 *
 * Inputs are assembled from replay: realized gains from the ledger's own
 * disposition records, dividend and interest income from the postings of the
 * matching journal types, and deductible interest from the INVESTMENT share
 * of each interest charge's facility-use attribution. Anything that cannot be
 * derived is left out and named in `uncertaintyReasons` — never replaced by a
 * zero that would read as a real figure.
 */
function deriveTaxSummary(
  state: LedgerState,
  journals: readonly Journal[],
  metaById: ReadonlyMap<string, AccountMeta>,
  reportingCurrency: string,
  requestedYear: number | undefined,
): TaxSummary | null {
  const posted = sortJournals(journals);
  const first = posted[0];
  const last = posted[posted.length - 1];
  if (!first || !last) {
    return null;
  }

  const firstYear = Number(first.tradeDate.slice(0, 4));
  const lastYear = Number(last.tradeDate.slice(0, 4));
  const year = requestedYear ?? lastYear;
  const prefix = `${year}-`;
  const byId = new Map(posted.map((journal) => [journal.id, journal]));
  const uncertaintyReasons: string[] = [];

  if (year < firstYear || year > lastYear) {
    // Outside the years the ledger covers, every figure below is zero purely
    // because there is nothing to read. Reported flat, that would assert the
    // household had no gains and no income that year, which this ledger is in
    // no position to claim. A quiet year *inside* the range is different: its
    // zeroes are facts, and are left unflagged.
    uncertaintyReasons.push(
      `${year} is outside the years this ledger covers (${firstYear} to ${lastYear}). ` +
        `These figures reflect an absence of records, not an absence of activity.`,
    );
  }

  const realizedGains: CanadaTaxYearArgs["realizedGains"] = [];
  for (const gain of state.realized) {
    const journal = byId.get(gain.journalId);
    if (!journal?.tradeDate.startsWith(prefix)) continue;

    const currency = journalCurrency(journal);
    if (isUnknownCost(gain.costState)) {
      uncertaintyReasons.push(
        `${gain.journalId}: sold ${gain.securityId} with no recorded cost basis, ` +
          `so its gain is excluded from the year.`,
      );
      continue;
    }
    if (currency !== reportingCurrency) {
      uncertaintyReasons.push(
        `${gain.journalId}: proceeds are in ${currency} and no rate is available, ` +
          `so the gain is excluded from the year.`,
      );
      continue;
    }
    realizedGains.push({
      gainReportingMinor: gain.gainReportingMinor,
      tradeDate: journal.tradeDate,
      journalId: gain.journalId,
    });
  }

  let dividendIncomeMinor = 0n;
  let interestIncomeMinor = 0n;
  let deductibleInvestmentInterestMinor = 0n;

  for (const journal of posted) {
    if (!journal.tradeDate.startsWith(prefix)) continue;

    if (journal.type === "DIVIDEND" || journal.type === "INTEREST_EARNED") {
      const currency = journalCurrency(journal);
      if (currency !== reportingCurrency) {
        uncertaintyReasons.push(
          `${journal.id}: income is in ${currency} and no rate is available, so it ` +
            `is excluded from the year.`,
        );
        continue;
      }
      // Income is what landed in a household account; the EXTERNAL leg is the
      // payer, not income.
      let received = 0n;
      for (const posting of journal.postings) {
        if (metaById.get(posting.accountId)?.type === "EXTERNAL") continue;
        if (posting.amount.minor > 0n) received += posting.amount.minor;
      }
      if (journal.type === "DIVIDEND") {
        dividendIncomeMinor += received;
      } else {
        interestIncomeMinor += received;
      }
      continue;
    }

    if (journal.type !== "INTEREST_CHARGED") continue;

    // Only the INVESTMENT share of a charge is deductible, and that share is
    // knowable only from the facility-use attribution the ledger requires on
    // a draw. Interest paid straight out of cash carries no such attribution,
    // so its deductible portion is not derivable here.
    if (!journal.facilityUses || journal.facilityUses.length === 0) {
      uncertaintyReasons.push(
        `${journal.id}: interest charged with no facility-use attribution, so its ` +
          `deductible share is not derivable and is excluded.`,
      );
      continue;
    }
    for (const line of journal.facilityUses) {
      if (line.use !== "INVESTMENT") continue;
      if (line.amount.currency !== reportingCurrency) {
        uncertaintyReasons.push(
          `${journal.id}: interest is in ${line.amount.currency} and no rate is ` +
            `available, so it is excluded from the year.`,
        );
        continue;
      }
      deductibleInvestmentInterestMinor += line.amount.minor;
    }
  }

  const summary = summarizeCanadaTaxYear({
    year,
    realizedGains,
    dividendIncomeMinor,
    interestIncomeMinor,
    deductibleInvestmentInterestMinor,
  });

  return {
    jurisdiction: summary.jurisdiction,
    year: summary.year,
    realizedGainsMinor: summary.realizedGainsReportingMinor.toString(),
    realizedLossesMinor: summary.realizedLossesReportingMinor.toString(),
    taxableCapitalGainsMinor: summary.taxableCapitalGainsMinor.toString(),
    inclusionRateBps: summary.inclusionRateBps,
    dividendIncomeMinor: summary.dividendIncomeMinor.toString(),
    interestIncomeMinor: summary.interestIncomeMinor.toString(),
    deductibleInterestExpenseMinor:
      summary.deductibleInterestExpenseMinor.toString(),
    // Carried through untouched: flags inform, they never adjust the figures.
    flags: summary.flags,
    disclaimer: summary.disclaimer,
    isUncertain: uncertaintyReasons.length > 0,
    uncertaintyReasons,
  };
}

/** A journal's single posting currency (`assertJournalBalanced` enforces one). */
function journalCurrency(journal: Journal): string | undefined {
  return journal.postings[0]?.amount.currency;
}

/**
 * Borrowing-screen figures: outstanding balances, use slices, YTD actual
 * interest, and modelled-vs-actual variance when terms + a benchmark curve
 * are available.
 *
 * Modelled interest is always an estimate. Missing terms or curve never
 * become a zero rate — the field stays `null` with a reason.
 */
function deriveBorrowing(args: {
  accounts: readonly AccountMeta[];
  journals: readonly Journal[];
  ledgerAccounts: ReadonlyMap<string, Account>;
  reportingCurrency: string;
  facilityTerms: readonly FacilityTermsInput[];
  asOf?: string;
}): BorrowingSummary {
  const facilitiesMeta = args.accounts.filter((a) => a.type === "CREDIT_FACILITY");
  if (facilitiesMeta.length === 0) {
    return emptyBorrowing();
  }

  const posted = sortJournals(args.journals);
  const asOf =
    args.asOf ??
    posted[posted.length - 1]?.tradeDate ??
    null;

  const termsByFacility = new Map(
    args.facilityTerms.map((entry) => [entry.terms.facilityAccountId, entry]),
  );

  const facilities: FacilityBorrowing[] = facilitiesMeta.map((meta) =>
    deriveFacilityBorrowing({
      meta,
      journals: posted,
      ledgerAccounts: args.ledgerAccounts,
      termsInput: termsByFacility.get(meta.id),
      asOf,
    }),
  );
  facilities.sort((a, b) => a.accountName.localeCompare(b.accountName));

  return aggregateBorrowing(facilities, args.reportingCurrency);
}

function deriveFacilityBorrowing(args: {
  meta: AccountMeta;
  journals: readonly Journal[];
  ledgerAccounts: ReadonlyMap<string, Account>;
  termsInput: FacilityTermsInput | undefined;
  asOf: string | null;
}): FacilityBorrowing {
  const { meta, journals, ledgerAccounts, termsInput, asOf } = args;
  const uncertaintyReasons: string[] = [];

  const slices = replayFacilitySlices(journals, ledgerAccounts, meta.id);
  const outstanding =
    slices.facilityBalanceMinor < 0n ? -slices.facilityBalanceMinor : 0n;
  const useBreakdown = useBreakdownFromSlices(slices.slices, outstanding);
  const investmentOwed = slices.slices.INVESTMENT ?? 0n;
  const investmentShareBps =
    outstanding === 0n
      ? null
      : Number((investmentOwed * TOTAL_BPS) / outstanding);

  // YTD window: calendar year of asOf, half-open [yearStart, asOf+1).
  // Without asOf there is nothing to put a year end on — treat YTD interest
  // as zero (no charged activity to window), not unknown.
  let interestChargedYtdMinor = 0n;
  let investmentInterestYtdMinor: bigint | null = 0n;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  if (asOf !== null) {
    const year = Number(asOf.slice(0, 4));
    periodStart = `${year}-01-01`;
    periodEnd = addCalendarDays(asOf, 1);

    const ytd = actualInterestYtd({
      journals,
      accounts: ledgerAccounts,
      facilityAccountId: meta.id,
      periodStart,
      periodEnd,
    });
    interestChargedYtdMinor = ytd.actualPostedMinor;
    investmentInterestYtdMinor = ytd.investmentMinor;
    uncertaintyReasons.push(...ytd.uncertaintyReasons);
  }

  let effectiveRateBps: number | null = null;
  let variance: FacilityInterestVariance | null = null;
  let interestOverTime: FacilityInterestPoint[] = [];

  if (asOf === null || periodStart === null || periodEnd === null) {
    // No activity and no asOf — nothing to model.
  } else if (termsInput === undefined) {
    uncertaintyReasons.push(
      `${meta.name}: no facility terms are on file, so the effective rate and ` +
        `modelled interest cannot be derived.`,
    );
    interestOverTime = interestOverTimeFromActualOnly({
      journals,
      accounts: ledgerAccounts,
      facilityAccountId: meta.id,
      periodStart,
      periodEnd,
    });
  } else if (termsInput.benchmarkCurve.length === 0) {
    uncertaintyReasons.push(
      `${meta.name}: facility terms name a benchmark but no rate points are ` +
        `available, so the effective rate and modelled interest cannot be derived.`,
    );
    interestOverTime = interestOverTimeFromActualOnly({
      journals,
      accounts: ledgerAccounts,
      facilityAccountId: meta.id,
      periodStart,
      periodEnd,
    });
  } else {
    try {
      effectiveRateBps =
        rateBpsOnDate(termsInput.benchmarkCurve, asOf) + termsInput.terms.spreadBps;
    } catch {
      uncertaintyReasons.push(
        `${meta.name}: no benchmark rate is effective on or before ${asOf}, so ` +
          `the effective rate and modelled interest cannot be derived.`,
      );
      interestOverTime = interestOverTimeFromActualOnly({
        journals,
        accounts: ledgerAccounts,
        facilityAccountId: meta.id,
        periodStart,
        periodEnd,
      });
      return {
        accountId: meta.id,
        accountName: meta.name,
        currency: meta.currency,
        minorUnits: meta.minorUnits,
        outstandingMinor: outstanding.toString(),
        useBreakdown,
        investmentShareBps,
        effectiveRateBps: null,
        interestChargedYtdMinor: interestChargedYtdMinor.toString(),
        investmentInterestYtdMinor:
          investmentInterestYtdMinor === null
            ? null
            : investmentInterestYtdMinor.toString(),
        variance: null,
        interestOverTime,
        uncertaintyReasons,
      };
    }

    // periodEnd must be after periodStart for modelInterest; a household asOf
    // on Jan 1 still models that one day via periodEnd = Jan 2.
    if (periodEnd <= periodStart) {
      uncertaintyReasons.push(
        `${meta.name}: interest period is empty, so modelled interest cannot be derived.`,
      );
    } else {
      const model = modelInterest({
        journals,
        accounts: ledgerAccounts,
        terms: termsInput.terms,
        benchmarkCurve: termsInput.benchmarkCurve,
        periodStart,
        periodEnd,
      });
      const result = interestVariance(model, journals, ledgerAccounts);
      const modelledByUse: Partial<Record<FacilityUse, string>> = {};
      for (const use of FACILITY_USES) {
        const v = result.modelledByUse[use];
        if (v !== undefined && v !== 0n) modelledByUse[use] = v.toString();
      }
      variance = {
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        modelledTotalMinor: result.modelledTotalMinor.toString(),
        actualPostedMinor: result.actualPostedMinor.toString(),
        varianceMinor: result.varianceMinor.toString(),
        modelledByUse,
        modelledIsEstimate: true,
      };
      interestOverTime = interestOverTimeFromModel(model.days, {
        journals,
        accounts: ledgerAccounts,
        facilityAccountId: meta.id,
        periodStart,
        periodEnd,
      });
    }
  }

  return {
    accountId: meta.id,
    accountName: meta.name,
    currency: meta.currency,
    minorUnits: meta.minorUnits,
    outstandingMinor: outstanding.toString(),
    useBreakdown,
    investmentShareBps,
    effectiveRateBps,
    interestChargedYtdMinor: interestChargedYtdMinor.toString(),
    investmentInterestYtdMinor:
      investmentInterestYtdMinor === null
        ? null
        : investmentInterestYtdMinor.toString(),
    variance,
    interestOverTime,
    uncertaintyReasons,
  };
}

function useBreakdownFromSlices(
  slices: Partial<Record<FacilityUse, bigint>>,
  outstanding: bigint,
): FacilityUseRow[] {
  const weights = FACILITY_USES.map((use) => slices[use] ?? 0n);
  const bpsParts =
    outstanding === 0n ? null : allocateExact(TOTAL_BPS, weights);

  return FACILITY_USES.map((use, i) => ({
    use,
    owedMinor: (slices[use] ?? 0n).toString(),
    bps: bpsParts === null ? null : Number(bpsParts[i]!),
  }));
}

/**
 * Actual interest charged on a facility in [periodStart, periodEnd), plus the
 * INVESTMENT-attributed share when every charge carries use lines.
 *
 * Posted totals come from the ledger's `actualInterestCharged`. A charge with
 * no facility-use attribution makes the investment share unknown (`null`)
 * rather than a quiet understatement.
 */
function actualInterestYtd(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<string, Account>;
  facilityAccountId: string;
  periodStart: string;
  periodEnd: string;
}): {
  actualPostedMinor: bigint;
  investmentMinor: bigint | null;
  uncertaintyReasons: string[];
} {
  const { journals, accounts, facilityAccountId, periodStart, periodEnd } = args;
  const { actualPostedMinor, actualJournalIds } = actualInterestCharged({
    journals,
    accounts,
    facilityAccountId,
    periodStart,
    periodEnd,
  });

  let investmentMinor = 0n;
  const uncertaintyReasons: string[] = [];
  let investmentUnknown = false;
  const counted = new Set(actualJournalIds);

  for (const journal of journals) {
    if (!counted.has(journal.id)) continue;

    if (!journal.facilityUses || journal.facilityUses.length === 0) {
      investmentUnknown = true;
      uncertaintyReasons.push(
        `${journal.id}: interest was charged with no facility-use attribution, so ` +
          `how much of it financed investing is not derivable.`,
      );
      continue;
    }
    for (const line of journal.facilityUses) {
      if (line.use === "INVESTMENT") investmentMinor += line.amount.minor;
    }
  }

  return {
    actualPostedMinor,
    investmentMinor: investmentUnknown ? null : investmentMinor,
    uncertaintyReasons,
  };
}

function interestOverTimeFromModel(
  days: readonly { date: string; interestTotalMinor: bigint }[],
  actualArgs: {
    journals: readonly Journal[];
    accounts: ReadonlyMap<string, Account>;
    facilityAccountId: string;
    periodStart: string;
    periodEnd: string;
  },
): FacilityInterestPoint[] {
  const modelledByMonth = new Map<string, bigint>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    modelledByMonth.set(
      month,
      (modelledByMonth.get(month) ?? 0n) + day.interestTotalMinor,
    );
  }
  const actualByMonth = actualInterestByMonth(actualArgs);
  const months = new Set([...modelledByMonth.keys(), ...actualByMonth.keys()]);
  return [...months]
    .sort()
    .map((month) => ({
      month,
      modelledMinor: (modelledByMonth.get(month) ?? 0n).toString(),
      modelledIsEstimate: true as const,
      actualMinor: (actualByMonth.get(month) ?? 0n).toString(),
    }));
}

function interestOverTimeFromActualOnly(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<string, Account>;
  facilityAccountId: string;
  periodStart: string;
  periodEnd: string;
}): FacilityInterestPoint[] {
  const actualByMonth = actualInterestByMonth(args);
  return [...actualByMonth.keys()]
    .sort()
    .map((month) => ({
      month,
      modelledMinor: null,
      modelledIsEstimate: true as const,
      actualMinor: (actualByMonth.get(month) ?? 0n).toString(),
    }));
}

function actualInterestByMonth(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<string, Account>;
  facilityAccountId: string;
  periodStart: string;
  periodEnd: string;
}): Map<string, bigint> {
  const byMonth = new Map<string, bigint>();
  const { actualJournalIds } = actualInterestCharged({
    journals: args.journals,
    accounts: args.accounts,
    facilityAccountId: args.facilityAccountId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  const counted = new Set(actualJournalIds);

  for (const journal of args.journals) {
    if (!counted.has(journal.id)) continue;

    let facilityDelta = 0n;
    for (const posting of journal.postings) {
      if (posting.accountId === args.facilityAccountId) {
        facilityDelta += posting.amount.minor;
      }
    }

    let charged = 0n;
    if (facilityDelta < 0n) {
      charged = -facilityDelta;
    } else {
      for (const posting of journal.postings) {
        if (posting.amount.minor > 0n) charged += posting.amount.minor;
      }
    }

    const month = journal.tradeDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0n) + charged);
  }
  return byMonth;
}

function aggregateBorrowing(
  facilities: readonly FacilityBorrowing[],
  reportingCurrency: string,
): BorrowingSummary {
  if (facilities.length === 0) return emptyBorrowing();

  let outstanding = 0n;
  let outstandingUncertain = false;
  let interestYtd = 0n;
  let interestYtdKnown = true;
  let investmentOwed = 0n;
  let totalOwedForShare = 0n;
  const uncertaintyReasons: string[] = [];
  const rates: { rate: number; weight: bigint }[] = [];
  let rateBlocked = false;

  for (const facility of facilities) {
    uncertaintyReasons.push(...facility.uncertaintyReasons);

    if (facility.currency !== reportingCurrency) {
      outstandingUncertain = true;
      // Omit from reporting-currency totals — same rule as sumTotals.
      continue;
    }

    const owed = BigInt(facility.outstandingMinor);
    outstanding += owed;
    interestYtd += BigInt(facility.interestChargedYtdMinor);

    const inv = facility.useBreakdown.find((u) => u.use === "INVESTMENT");
    investmentOwed += BigInt(inv?.owedMinor ?? "0");
    totalOwedForShare += owed;

    if (owed > 0n) {
      if (facility.effectiveRateBps === null) {
        rateBlocked = true;
      } else {
        rates.push({ rate: facility.effectiveRateBps, weight: owed });
      }
    }

    if (facility.investmentInterestYtdMinor === null) {
      interestYtdKnown = true; // charged YTD itself is still known
    }
  }

  let effectiveRateBps: number | null = null;
  if (!rateBlocked && rates.length > 0) {
    const weightSum = rates.reduce((s, r) => s + r.weight, 0n);
    if (weightSum === 0n) {
      effectiveRateBps = rates[0]!.rate;
    } else {
      // Integer weighted average, floor — bps are already integers.
      let acc = 0n;
      for (const r of rates) acc += BigInt(r.rate) * r.weight;
      effectiveRateBps = Number(acc / weightSum);
    }
  } else if (rateBlocked) {
    // Only mention once at the household level when a facility already named it.
    if (
      !uncertaintyReasons.some((r) =>
        /effective rate and modelled interest cannot be derived/i.test(r),
      )
    ) {
      uncertaintyReasons.push(
        "At least one facility with an outstanding balance has no effective rate, " +
          "so a household effective rate cannot be stated.",
      );
    }
  } else if (facilities.length === 1) {
    // Zero outstanding: still surface the single facility's rate when known.
    effectiveRateBps = facilities[0]!.effectiveRateBps;
  }

  void interestYtdKnown;

  return {
    facilities: [...facilities],
    outstandingMinor: outstanding.toString(),
    outstandingIsUncertain: outstandingUncertain,
    effectiveRateBps,
    interestChargedYtdMinor: interestYtd.toString(),
    investmentShareBps:
      totalOwedForShare === 0n
        ? null
        : Number((investmentOwed * TOTAL_BPS) / totalOwedForShare),
    uncertaintyReasons,
  };
}
