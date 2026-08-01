import { eq } from "drizzle-orm";
import {
  account,
  createJournalRepo,
  household,
  type Db,
} from "@stonks/db";
import { replay, type Account } from "@stonks/ledger";
import { getDb } from "@/lib/db";

type BalanceEntry = {
  accountId: string;
  currency: string;
  minor: string;
};

type BalancesResponse = {
  householdId?: string;
  reportingCurrency?: string;
  ledgerVersion?: number;
  balances: BalanceEntry[];
  message?: string;
};

export async function GET(): Promise<Response> {
  const db = getDb();
  if (!db) {
    return Response.json({ balances: [], message: "DATABASE_URL not configured" });
  }

  try {
    const result = await getBalances(db);
    return Response.json(result);
  } catch (error) {
    console.error("balances route error:", error);
    return Response.json({ balances: [], message: "failed to load balances" }, { status: 500 });
  }
}

async function getBalances(db: Db): Promise<BalancesResponse> {
  const householdRow = await db.select().from(household).limit(1).then((rows) => rows[0]);

  if (!householdRow) {
    return { balances: [], ledgerVersion: 0, message: "no household" };
  }

  const householdId = householdRow.id;
  const reportingCurrency = householdRow.reportingCurrency;

  const accountRows = await db
    .select()
    .from(account)
    .where(eq(account.householdId, householdId));

  if (accountRows.length === 0) {
    return { householdId, reportingCurrency, balances: [], ledgerVersion: 0, message: "no accounts" };
  }

  const accountsMap = new Map<string, Account>(
    accountRows.map((row) => [
      row.id,
      { id: row.id, type: row.type, currency: row.currency },
    ]),
  );

  const repo = createJournalRepo(db);
  const journals = await repo.listPosted(householdId);
  const state = replay(journals, accountsMap, reportingCurrency);

  const balances: BalanceEntry[] = [];
  for (const [accountId, balance] of state.balances) {
    balances.push({
      accountId,
      currency: balance.currency,
      minor: balance.minor.toString(),
    });
  }

  balances.sort((a, b) => a.accountId.localeCompare(b.accountId));

  return {
    householdId,
    reportingCurrency,
    ledgerVersion: state.ledgerVersion,
    balances,
  };
}
