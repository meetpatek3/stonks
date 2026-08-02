import {
  account,
  createJournalRepo,
  currency,
  eq,
  household,
  type Db,
} from "@stonks/db";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";
import { emptyPortfolioSnapshot, type PortfolioSnapshot } from "@/lib/portfolio-shared";

export type {
  BalanceRow,
  OpenItemCounts,
  PortfolioSnapshot,
  PositionRow,
} from "@/lib/portfolio-shared";
export { formatMoney } from "@/lib/portfolio-shared";

/**
 * Load the household's accounts and posted journals, then hand them to the
 * pure read model. This function only does persistence; every displayed
 * number is derived by replay in `lib/portfolio-derive.ts`.
 */
export async function getPortfolioSnapshot(
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
