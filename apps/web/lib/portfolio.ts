import {
  account,
  createFacilityTermsRepo,
  createJournalRepo,
  createPriceRepo,
  currency,
  eq,
  household,
  type Db,
} from "@stonks/db";
import type { Journal } from "@stonks/ledger";
import { cache } from "react";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { createQuoteFetcher } from "@/lib/market/provider";
import { createPriceService, type ResolvedPrice } from "@/lib/market/price-service";
import { loadSecurityRefs } from "@/lib/market/symbols";
import {
  mostRecentlyUsedAccountId,
  todayIsoDate,
} from "@/lib/journals";
import {
  toJournalRows,
  type AccountRef,
  type JournalRow,
} from "@/lib/ledger-table";
import {
  derivePortfolioSnapshot,
  heldSecurityIds,
  type AccountMeta,
  type FacilityTermsInput,
} from "@/lib/portfolio-derive";
import { emptyPortfolioSnapshot, type PortfolioSnapshot } from "@/lib/portfolio-shared";

export type {
  AllocationBasis,
  AllocationRow,
  BalanceRow,
  BorrowingSummary,
  FacilityBorrowing,
  FacilityInterestPoint,
  FacilityInterestVariance,
  FacilityUseRow,
  OpenItem,
  OpenItemCounts,
  OpenItemKind,
  OpenItemRefType,
  OpenItemSeverity,
  PortfolioSnapshot,
  PositionRow,
  TaxSummary,
  ValuationSummary,
  ValuePoint,
} from "@/lib/portfolio-shared";
export { formatMoney } from "@/lib/portfolio-shared";

/**
 * Load the household's accounts and posted journals, then hand them to the
 * pure read model. This function only does persistence; every displayed
 * number is derived by replay in `lib/portfolio-derive.ts`.
 *
 * Exported through `getPortfolioSnapshot`, which memoizes it per request —
 * call that, not this.
 */
async function loadPortfolioSnapshot(
  db: Db,
  householdId: string,
  taxYear?: number,
): Promise<PortfolioSnapshot> {
  const householdRow = await db
    .select()
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!householdRow) {
    return emptyPortfolioSnapshot({ message: "household not found" });
  }

  const reportingCurrency = householdRow.reportingCurrency;

  // The reporting currency's own scale. `household.reportingCurrency` is a
  // NOT NULL foreign key onto `currency.code`, so this row exists; it is read
  // explicitly rather than inferred from the accounts because a
  // reporting-currency amount (an ACB cost, a tax figure) can exist with no
  // account denominated in that currency at all.
  const reportingMinorUnits = await db
    .select({ minorUnits: currency.minorUnits })
    .from(currency)
    .where(eq(currency.code, reportingCurrency))
    .limit(1)
    .then((rows) => rows[0]?.minorUnits);

  const accountRows = await db
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      minorUnits: currency.minorUnits,
    })
    .from(account)
    .innerJoin(currency, eq(account.currency, currency.code))
    .where(eq(account.householdId, householdId));

  const accounts: AccountMeta[] = accountRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    minorUnits: row.minorUnits,
  }));

  const repo = createJournalRepo(db);
  const journals = await repo.listPosted(householdId);

  // UTC asOf — same date basis as price resolution and the ledger tables.
  const asOf = new Date().toISOString().slice(0, 10);

  return derivePortfolioSnapshot({
    householdId,
    reportingCurrency,
    ...(reportingMinorUnits === undefined ? {} : { reportingMinorUnits }),
    accounts,
    journals,
    prices: await resolveHeldPrices(db, householdId, journals),
    facilityTerms: await loadFacilityTerms(db, householdId, asOf),
    asOf,
    ...(taxYear === undefined ? {} : { taxYear }),
  });
}

/**
 * Effective facility terms + their benchmark curves for interest modelling.
 *
 * Persistence only — the read model refuses to invent a rate when a facility
 * has no covering terms row or the curve has no point on/before asOf.
 */
async function loadFacilityTerms(
  db: Db,
  householdId: string,
  asOf: string,
): Promise<FacilityTermsInput[]> {
  try {
    const repo = createFacilityTermsRepo(db);
    const records = await repo.listEffectiveTerms(householdId, asOf);
    if (records.length === 0) return [];

    const curves = await repo.listBenchmarkCurves(
      records.map((record) => record.benchmarkId),
    );

    return records.map((record) => ({
      terms: record.terms,
      benchmarkCurve: curves.get(record.benchmarkId)?.points ?? [],
    }));
  } catch {
    // A terms lookup failure must not fail the whole portfolio: the
    // borrowing screen still shows actual balances and posted interest, and
    // marks modelled figures unknown.
    return [];
  }
}

/**
 * Market prices for the securities still held, as of today.
 *
 * This is the asynchronous, I/O half of valuation, kept out of the pure
 * derivation: prices arrive as data, so the read model stays synchronous and
 * unit-testable. Only held securities are priced — a holding sold years ago
 * would otherwise spend an API request on every page load, forever.
 *
 * Nothing here is allowed to fail a render. A database or provider failure
 * degrades to no prices, which the read model states as "carried at cost"
 * rather than as a number.
 */
async function resolveHeldPrices(
  db: Db,
  householdId: string,
  journals: readonly Journal[],
): Promise<ResolvedPrice[]> {
  const securityIds = heldSecurityIds(journals);
  if (securityIds.length === 0) return [];

  // UTC, matching the dates the ledger and the quote tables are keyed on. A
  // household west of Greenwich asking late in the evening asks for a date
  // whose close does not exist yet, and gets the previous close back marked
  // stale — visibly a day behind, never silently relabelled as today's.
  const asOf = new Date().toISOString().slice(0, 10);

  try {
    const securities = await loadSecurityRefs(db, securityIds, asOf);
    if (securities.length === 0) return [];

    const service = createPriceService({
      repo: createPriceRepo(db),
      fetcher: createQuoteFetcher(),
    });
    return await service.resolvePrices({ householdId, securities, asOf });
  } catch {
    return [];
  }
}

/**
 * The request-scoped entry point for the read model.
 *
 * A snapshot replays every posted journal, and more than one server component
 * in a single render legitimately needs one — the shell needs the open-items
 * count while the page needs the whole thing. `React.cache` dedupes those to
 * a single replay per request, keyed on the arguments; `getDb()` returns a
 * module singleton, so the `db` argument is reference-stable.
 *
 * Outside a React request (unit tests, scripts) `cache` degrades to a plain
 * call, so this is safe to import anywhere.
 */
export const getPortfolioSnapshot = cache(loadPortfolioSnapshot);

/**
 * The snapshot for the current request, or an empty one naming why there is
 * none.
 *
 * Every page renders the same two failure modes — no database configured, and
 * no session — and each one's `EmptyState` reads the reason off
 * `snapshot.message`. Single-sourced here so the wording and the precedence
 * (a missing database is reported before a missing session, because it is the
 * more fundamental one) cannot drift between routes.
 */
export async function loadSessionSnapshot(options?: {
  /** Overrides the default tax year (year of the most recent posted journal). */
  taxYear?: number;
}): Promise<PortfolioSnapshot> {
  const db = getDb();
  if (!db) {
    return emptyPortfolioSnapshot({ message: "DATABASE_URL not configured" });
  }

  const session = await getSession();
  if (!session) {
    return emptyPortfolioSnapshot({ message: "not authenticated" });
  }

  if (options?.taxYear !== undefined) {
    return getPortfolioSnapshot(db, session.householdId, options.taxYear);
  }
  return getPortfolioSnapshot(db, session.householdId);
}

/**
 * Every journal for the current household, including `SUPERSEDED`, projected
 * into serialisable grid rows.
 *
 * Kept separate from `loadSessionSnapshot` on purpose: replay and the read
 * model see only `POSTED` journals. The ledger screen is the one place that
 * needs the audit history, so it pays for `listAll` rather than making every
 * page load it.
 *
 * Failure modes match the snapshot helper so the screen's EmptyState can
 * reuse the same `message` strings.
 */
export async function loadSessionJournalRows(): Promise<{
  rows: JournalRow[];
  accounts: AccountRef[];
  message?: string;
}> {
  const db = getDb();
  if (!db) {
    return { rows: [], accounts: [], message: "DATABASE_URL not configured" };
  }

  const session = await getSession();
  if (!session) {
    return { rows: [], accounts: [], message: "not authenticated" };
  }

  const householdId = session.householdId;

  const householdRow = await db
    .select()
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!householdRow) {
    return { rows: [], accounts: [], message: "household not found" };
  }

  const accountRows = await db
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      minorUnits: currency.minorUnits,
    })
    .from(account)
    .innerJoin(currency, eq(account.currency, currency.code))
    .where(eq(account.householdId, householdId));

  const accounts: AccountRef[] = accountRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    minorUnits: row.minorUnits,
  }));

  if (accounts.length === 0) {
    return { rows: [], accounts, message: "no accounts" };
  }

  const journals = await createJournalRepo(db).listAll(householdId);
  return { rows: toJournalRows(journals, accounts), accounts };
}

/**
 * Accounts + defaults for the fast-entry form. Open accounts only; the MRU
 * pick is the latest non-EXTERNAL account touched by a POSTED journal.
 */
export async function loadEntryFormData(): Promise<{
  accounts: AccountRef[];
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  message?: string;
}> {
  const db = getDb();
  if (!db) {
    return {
      accounts: [],
      reportingCurrency: "CAD",
      minorUnits: 2,
      mruAccountId: null,
      defaultTradeDate: todayIsoDate(),
      message: "DATABASE_URL not configured",
    };
  }

  const session = await getSession();
  if (!session) {
    return {
      accounts: [],
      reportingCurrency: "CAD",
      minorUnits: 2,
      mruAccountId: null,
      defaultTradeDate: todayIsoDate(),
      message: "not authenticated",
    };
  }

  const householdId = session.householdId;

  const householdRow = await db
    .select()
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!householdRow) {
    return {
      accounts: [],
      reportingCurrency: "CAD",
      minorUnits: 2,
      mruAccountId: null,
      defaultTradeDate: todayIsoDate(),
      message: "household not found",
    };
  }

  const reportingCurrency = householdRow.reportingCurrency;

  const [currencyRow] = await db
    .select({ minorUnits: currency.minorUnits })
    .from(currency)
    .where(eq(currency.code, reportingCurrency))
    .limit(1);

  const minorUnits = currencyRow?.minorUnits ?? 2;

  const accountRows = await db
    .select({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      minorUnits: currency.minorUnits,
      closedAt: account.closedAt,
    })
    .from(account)
    .innerJoin(currency, eq(account.currency, currency.code))
    .where(eq(account.householdId, householdId));

  const accounts: AccountRef[] = accountRows
    .filter((row) => row.closedAt === null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      minorUnits: row.minorUnits,
    }));

  if (accounts.length === 0) {
    return {
      accounts,
      reportingCurrency,
      minorUnits,
      mruAccountId: null,
      defaultTradeDate: todayIsoDate(),
      message: "no accounts",
    };
  }

  const journals = await createJournalRepo(db).listPosted(householdId);
  const selectable = new Set(
    accounts.filter((a) => a.type !== "EXTERNAL").map((a) => a.id),
  );
  const mruAccountId = mostRecentlyUsedAccountId(journals, selectable);

  return {
    accounts,
    reportingCurrency,
    minorUnits,
    mruAccountId,
    defaultTradeDate: todayIsoDate(),
  };
}
