import {
  account,
  createJournalRepo,
  currency,
  eq,
  household,
  type Db,
} from "@stonks/db";
import { cache } from "react";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";
import { emptyPortfolioSnapshot, type PortfolioSnapshot } from "@/lib/portfolio-shared";

export type {
  AllocationBasis,
  AllocationRow,
  BalanceRow,
  OpenItem,
  OpenItemCounts,
  OpenItemKind,
  OpenItemRefType,
  OpenItemSeverity,
  PortfolioSnapshot,
  PositionRow,
  TaxSummary,
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

  return derivePortfolioSnapshot({
    householdId,
    reportingCurrency,
    accounts,
    journals,
  });
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
