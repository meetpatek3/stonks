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

  const supersededId = `j-superseded-${suffix}`;
  const correctionId = `j-correction-${suffix}`;

  afterAll(async () => {
    for (const id of [journalId, supersededId, correctionId]) {
      await db.delete(posting).where(eq(posting.journalId, id));
      await db.delete(journal).where(eq(journal.id, id));
    }
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

  it("listAll returns SUPERSEDED journals with supersedesJournalId; listPosted does not", async () => {
    // Correction workflow: an earlier posted journal is superseded in place
    // (status flip), and a new POSTED journal points at it via
    // supersedesJournalId. Insert the original as POSTED, then flip it and
    // insert the correction — insertPosted rejects non-POSTED.
    const original: Journal = {
      id: supersededId,
      type: "DEPOSIT",
      tradeDate: "2024-02-01",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      memo: "wrong amount",
      postings: [
        { accountId: extAccountId, amount: money("CAD", -50_000n) },
        { accountId: cashAccountId, amount: money("CAD", 50_000n) },
      ],
    };
    await repo.insertPosted(original, householdId);

    await db
      .update(journal)
      .set({ status: "SUPERSEDED" })
      .where(eq(journal.id, supersededId));

    const correction: Journal = {
      id: correctionId,
      type: "DEPOSIT",
      tradeDate: "2024-02-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      memo: "corrected amount",
      supersedesJournalId: supersededId,
      postings: [
        { accountId: extAccountId, amount: money("CAD", -75_000n) },
        { accountId: cashAccountId, amount: money("CAD", 75_000n) },
      ],
    };
    await repo.insertPosted(correction, householdId);

    const posted = await repo.listPosted(householdId);
    expect(posted.map((j) => j.id).sort()).toEqual(
      [journalId, correctionId].sort(),
    );
    expect(posted.every((j) => j.status === "POSTED")).toBe(true);

    const all = await repo.listAll(householdId);
    expect(all.map((j) => j.id).sort()).toEqual(
      [journalId, supersededId, correctionId].sort(),
    );

    const superseded = all.find((j) => j.id === supersededId);
    expect(superseded).toEqual(
      expect.objectContaining({
        id: supersededId,
        status: "SUPERSEDED",
        memo: "wrong amount",
      }),
    );
    expect(superseded!.postings).toHaveLength(2);
    expect(superseded!.postings[0]!.amount.minor).toBe(-50_000n);

    const correcting = all.find((j) => j.id === correctionId);
    expect(correcting?.supersedesJournalId).toBe(supersededId);
    expect(correcting?.status).toBe("POSTED");

    // Replay must still see only POSTED — listAll must not change that.
    const replayed = replay(posted, accounts, "CAD");
    const expected = replay(
      [depositJournal, { ...correction }],
      accounts,
      "CAD",
    );
    expect(replayed.ledgerVersion).toBe(expected.ledgerVersion);
    expect(replayed.balances.get(cashAccountId)?.minor).toBe(
      expected.balances.get(cashAccountId)?.minor,
    );
  });
});
