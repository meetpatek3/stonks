import {
  allocateExact,
  isUnknownCost,
  qtyToDecimalString,
  replay,
  sortJournals,
  summarizeCanadaTaxYear,
  type Account,
  type AccountType,
  type CanadaTaxYearArgs,
  type Journal,
  type LedgerState,
} from "@stonks/ledger";
import {
  emptyBalancesByType,
  emptyPortfolioSnapshot,
  type AllocationRow,
  type BalanceRow,
  type OpenItem,
  type PortfolioSnapshot,
  type PositionRow,
  type TaxSummary,
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
   * Tax year for `taxSummary`. Defaults to the year of the most recent posted
   * journal — the latest year the ledger actually has something to say about,
   * and unlike "this year" it does not go blank as the wall clock rolls into
   * a year with no activity yet.
   */
  taxYear?: number;
};

/** Basis-point denominator: allocation shares always sum to this. */
const TOTAL_BPS = 10_000n;

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

  const positions: PositionRow[] = [];
  for (const [key, position] of state.positions) {
    const costUnknown = isUnknownCost(position.costState);
    positions.push({
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
    });
  }
  positions.sort((a, b) => a.key.localeCompare(b.key));

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
function deriveAllocation(positions: readonly PositionRow[]): {
  allocation: AllocationRow[];
  allocationIsIncomplete: boolean;
  /** Positions with a known but non-positive cost, excluded from the split. */
  zeroCost: PositionRow[];
} {
  const weighted: { position: PositionRow; cost: bigint }[] = [];
  const zeroCost: PositionRow[] = [];
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
  positions: readonly PositionRow[],
  zeroCostPositions: readonly PositionRow[],
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
