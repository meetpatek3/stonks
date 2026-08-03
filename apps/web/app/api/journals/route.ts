import { max } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  account,
  and,
  createJournalRepo,
  eq,
  household,
  journal,
} from "@stonks/db";
import type { Account } from "@stonks/ledger";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { createPostedJournal } from "@/lib/journals";

/**
 * POST /api/journals — create a POSTED journal for the session household.
 *
 * Body money is minor-unit strings. `sortKey` is assigned here from the max
 * existing key for (household, trade_date); a client-supplied key is rejected
 * inside `createPostedJournal`. Accounts are verified against the household
 * before anything is written.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [hh] = await db
    .select({ reportingCurrency: household.reportingCurrency })
    .from(household)
    .where(eq(household.id, session.householdId))
    .limit(1);

  if (!hh) {
    return NextResponse.json({ error: "Household not found" }, { status: 404 });
  }

  const accountRows = await db
    .select({
      id: account.id,
      type: account.type,
      currency: account.currency,
    })
    .from(account)
    .where(eq(account.householdId, session.householdId));

  const accounts = new Map<string, Account>(
    accountRows.map((row) => [
      row.id,
      { id: row.id, type: row.type, currency: row.currency },
    ]),
  );

  const repo = createJournalRepo(db);

  const result = await createPostedJournal(body, {
    householdId: session.householdId,
    accounts,
    reportingCurrency: hh.reportingCurrency,
    newId: () => crypto.randomUUID(),
    insertPosted: (j, householdId) => repo.insertPosted(j, householdId),
    async nextSortKeyForDate(tradeDate) {
      const [row] = await db
        .select({ maxKey: max(journal.sortKey) })
        .from(journal)
        .where(
          and(
            eq(journal.householdId, session.householdId),
            eq(journal.tradeDate, tradeDate),
            eq(journal.status, "POSTED"),
          ),
        );
      return (row?.maxKey ?? -1) + 1;
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
