import { eq } from "drizzle-orm";
import {
  account,
  createJournalRepo,
  currency,
  household,
  type Db,
} from "@stonks/db";
import { money, replay, type Account, type Journal } from "@stonks/ledger";
import { getDb } from "@/lib/db";

const DEMO_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_EXT_ACCOUNT_ID = "demo-ext";
const DEMO_CASH_ACCOUNT_ID = "demo-cash";
const DEMO_JOURNAL_ID = "demo-deposit";

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
  seeded?: boolean;
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
  let householdRow = await db.select().from(household).limit(1).then((rows) => rows[0]);
  let seeded = false;

  if (!householdRow) {
    await seedDemoHousehold(db);
    seeded = true;
    householdRow = await db
      .select()
      .from(household)
      .where(eq(household.id, DEMO_HOUSEHOLD_ID))
      .limit(1)
      .then((rows) => rows[0]);
  }

  if (!householdRow) {
    return { balances: [], message: "no household" };
  }

  const householdId = householdRow.id;
  const reportingCurrency = householdRow.reportingCurrency;

  const accountRows = await db
    .select()
    .from(account)
    .where(eq(account.householdId, householdId));

  if (accountRows.length === 0) {
    return { householdId, reportingCurrency, balances: [], message: "no accounts" };
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

  const response: BalancesResponse = {
    householdId,
    reportingCurrency,
    ledgerVersion: state.ledgerVersion,
    balances,
  };

  if (seeded) {
    response.seeded = true;
  }

  return response;
}

async function seedDemoHousehold(db: Db): Promise<void> {
  await db
    .insert(currency)
    .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
    .onConflictDoNothing();

  await db.insert(household).values({
    id: DEMO_HOUSEHOLD_ID,
    reportingCurrency: "CAD",
  });

  await db.insert(account).values([
    {
      id: DEMO_EXT_ACCOUNT_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      type: "EXTERNAL",
      currency: "CAD",
      name: "External",
    },
    {
      id: DEMO_CASH_ACCOUNT_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      type: "CASH",
      currency: "CAD",
      name: "Cash",
    },
  ]);

  const depositJournal: Journal = {
    id: DEMO_JOURNAL_ID,
    type: "DEPOSIT",
    tradeDate: "2024-01-01",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: DEMO_EXT_ACCOUNT_ID, amount: money("CAD", -100_000n) },
      { accountId: DEMO_CASH_ACCOUNT_ID, amount: money("CAD", 100_000n) },
    ],
  };

  const repo = createJournalRepo(db);
  await repo.insertPosted(depositJournal, DEMO_HOUSEHOLD_ID);
}
