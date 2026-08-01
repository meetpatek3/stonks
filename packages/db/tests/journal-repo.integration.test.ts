import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { money, replay } from "@stonks/ledger";
import type { Account, Journal } from "@stonks/ledger";
import { createDb } from "../src/client.js";
import { account, currency, household, journal, posting } from "../src/schema/index.js";
import { createJournalRepo } from "../src/repos/journal-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("journal repo integration", () => {
  const db = createDb(databaseUrl!);
  const repo = createJournalRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdId = crypto.randomUUID();
  const extAccountId = `ext-${suffix}`;
  const cashAccountId = `cash-${suffix}`;
  const journalId = `j-deposit-${suffix}`;

  const accounts = new Map<string, Account>([
    [extAccountId, { id: extAccountId, type: "EXTERNAL", currency: "CAD" }],
    [cashAccountId, { id: cashAccountId, type: "CASH", currency: "CAD" }],
  ]);

  const depositJournal: Journal = {
    id: journalId,
    type: "DEPOSIT",
    tradeDate: "2024-01-01",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: extAccountId, amount: money("CAD", -100_000n) },
      { accountId: cashAccountId, amount: money("CAD", 100_000n) },
    ],
  };

  beforeAll(async () => {
    await db.insert(currency).values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" }).onConflictDoNothing();
    await db.insert(household).values({
      id: householdId,
      reportingCurrency: "CAD",
    });
    await db.insert(account).values([
      {
        id: extAccountId,
        householdId,
        type: "EXTERNAL",
        currency: "CAD",
        name: "External",
      },
      {
        id: cashAccountId,
        householdId,
        type: "CASH",
        currency: "CAD",
        name: "Cash",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(posting).where(eq(posting.journalId, journalId));
    await db.delete(journal).where(eq(journal.id, journalId));
    await db.delete(account).where(eq(account.householdId, householdId));
    await db.delete(household).where(eq(household.id, householdId));
  });

  it("round-trips a deposit journal and replay matches in-memory apply", async () => {
    await repo.insertPosted(depositJournal, householdId);

    const listed = await repo.listPosted(householdId);
    expect(listed).toHaveLength(1);

    const expected = replay([depositJournal], accounts, "CAD");
    const actual = replay(listed, accounts, "CAD");

    expect(actual.ledgerVersion).toBe(expected.ledgerVersion);
    for (const [accountId, balance] of expected.balances) {
      const roundTripped = actual.balances.get(accountId);
      expect(roundTripped).toBeDefined();
      expect(roundTripped!.currency).toBe(balance.currency);
      expect(roundTripped!.minor).toBe(balance.minor);
    }
  });
});
