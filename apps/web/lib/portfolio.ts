import {
  account,
  createJournalRepo,
  currency,
  eq,
  household,
  type Db,
} from "@stonks/db";
import { replay, type Account } from "@stonks/ledger";
import type { BalanceRow, PortfolioSnapshot } from "@/lib/portfolio-shared";

export type { BalanceRow, PortfolioSnapshot } from "@/lib/portfolio-shared";
export { formatMoney } from "@/lib/portfolio-shared";

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
    return { balances: [], ledgerVersion: 0, message: "household not found" };
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

  if (accountRows.length === 0) {
    return {
      householdId,
      reportingCurrency,
      balances: [],
      ledgerVersion: 0,
      message: "no accounts",
    };
  }

  const accountsById = new Map(accountRows.map((row) => [row.id, row]));
  const accountsMap = new Map<string, Account>(
    accountRows.map((row) => [
      row.id,
      { id: row.id, type: row.type, currency: row.currency },
    ]),
  );

  const repo = createJournalRepo(db);
  const journals = await repo.listPosted(householdId);
  const state = replay(journals, accountsMap, reportingCurrency);

  const balances: BalanceRow[] = [];
  for (const [accountId, balance] of state.balances) {
    const meta = accountsById.get(accountId);
    balances.push({
      accountId,
      accountName: meta?.name ?? accountId,
      accountType: meta?.type ?? "UNKNOWN",
      currency: balance.currency,
      minor: balance.minor.toString(),
      minorUnits: meta?.minorUnits ?? 2,
    });
  }

  balances.sort((a, b) => a.accountName.localeCompare(b.accountName));

  return {
    householdId,
    reportingCurrency,
    ledgerVersion: state.ledgerVersion,
    balances,
  };
}
