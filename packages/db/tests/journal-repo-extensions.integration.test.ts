import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError, money, qtyFromDecimalString } from "@stonks/ledger";
import type { Journal } from "@stonks/ledger";
import { createDb } from "../src/client.js";
import { account, currency, household, journal, journalFacilityUse, posting } from "../src/schema/index.js";
import {
  createJournalRepo,
  decodeJournalCursor,
  encodeJournalCursor,
} from "../src/repos/journal-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

/**
 * Task 4 repo extensions, against real Postgres: filtered history incl.
 * superseded, single fetch with tenant isolation, natural-key lookup, next
 * sort_key, and transactional supersession with rollback.
 *
 * All expectations are hand-derived from the fixtures below — nothing is
 * captured from output.
 */
describeIfDb("journal repo extensions (integration)", () => {
  const db = createDb(databaseUrl!);
  const repo = createJournalRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdA = crypto.randomUUID();
  const householdB = crypto.randomUUID();

  const extA = `ext-a-${suffix}`;
  const cashA = `cash-a-${suffix}`;
  const investA = `invest-a-${suffix}`;
  const extB = `ext-b-${suffix}`;
  const cashB = `cash-b-${suffix}`;

  const journalIds = [
    `jx-dep-${suffix}`,     // A: 2024-01-05 DEPOSIT key0
    `jx-buy-${suffix}`,     // A: 2024-01-10 BUY key0
    `jx-dep2-${suffix}`,    // A: 2024-01-10 DEPOSIT key1
    `jx-fee-${suffix}`,     // A: 2024-02-01 FEE key0
    `jx-old-${suffix}`,     // A: 2024-03-01 superseded later
    `jx-new-${suffix}`,     // A: replacement for jx-old
    `jx-b-${suffix}`,       // B: 2024-01-05 DEPOSIT key0
  ];

  function deposit(id: string, tradeDate: string, sortKey: number, minor: bigint, extra?: Partial<Journal>): Journal {
    return {
      id,
      type: "DEPOSIT",
      tradeDate,
      sortKey,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: extA, amount: money("CAD", -minor) },
        { accountId: cashA, amount: money("CAD", minor) },
      ],
      ...extra,
    };
  }

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();
    await db.insert(household).values([
      { id: householdA, reportingCurrency: "CAD" },
      { id: householdB, reportingCurrency: "CAD" },
    ]);
    await db.insert(account).values([
      { id: extA, householdId: householdA, type: "EXTERNAL", currency: "CAD", name: "External A" },
      { id: cashA, householdId: householdA, type: "CASH", currency: "CAD", name: "Cash A" },
      { id: investA, householdId: householdA, type: "INVESTMENT", currency: "CAD", name: "Invest A" },
      { id: extB, householdId: householdB, type: "EXTERNAL", currency: "CAD", name: "External B" },
      { id: cashB, householdId: householdB, type: "CASH", currency: "CAD", name: "Cash B" },
    ]);

    // Household A history — inserted deliberately out of date order.
    await repo.insertPosted(deposit(`jx-dep-${suffix}`, "2024-01-05", 0, 100_000n), householdA);
    await repo.insertPosted(
      {
        id: `jx-fee-${suffix}`,
        type: "FEE",
        tradeDate: "2024-02-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        memo: "monthly fee",
        externalNaturalKey: `stmt-fee-${suffix}`,
        postings: [
          { accountId: cashA, amount: money("CAD", -1_000n) },
          { accountId: extA, amount: money("CAD", 1_000n) },
        ],
      },
      householdA,
    );
    await repo.insertPosted(
      {
        id: `jx-buy-${suffix}`,
        type: "BUY",
        tradeDate: "2024-01-10",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: cashA, amount: money("CAD", -50_000n) },
          {
            accountId: investA,
            amount: money("CAD", 50_000n),
            quantity: qtyFromDecimalString("10"),
            securityId: "SEC-1",
          },
        ],
      },
      householdA,
    );
    await repo.insertPosted(deposit(`jx-dep2-${suffix}`, "2024-01-10", 1, 25_000n), householdA);
    await repo.insertPosted(deposit(`jx-old-${suffix}`, "2024-03-01", 0, 5_000n), householdA);

    // Household B has exactly one journal — tenant-isolation probes target it.
    await repo.insertPosted(
      {
        ...deposit(`jx-b-${suffix}`, "2024-01-05", 0, 777_00n),
        postings: [
          { accountId: extB, amount: money("CAD", -777_00n) },
          { accountId: cashB, amount: money("CAD", 777_00n) },
        ],
      },
      householdB,
    );
  });

  afterAll(async () => {
    for (const id of journalIds) {
      await db.delete(posting).where(eq(posting.journalId, id));
      await db.delete(journalFacilityUse).where(eq(journalFacilityUse.journalId, id));
      await db.delete(journal).where(eq(journal.id, id));
    }
    await db.delete(account).where(eq(account.householdId, householdA));
    await db.delete(account).where(eq(account.householdId, householdB));
    await db.delete(household).where(eq(household.id, householdA));
    await db.delete(household).where(eq(household.id, householdB));
  });

  it("listAll defaults to POSTED only, ordered by (trade_date, sort_key, id)", async () => {
    const listed = await repo.listAll(householdA);
    expect(listed.map((j) => j.id)).toEqual([
      `jx-dep-${suffix}`,
      `jx-buy-${suffix}`,
      `jx-dep2-${suffix}`,
      `jx-fee-${suffix}`,
      `jx-old-${suffix}`,
    ]);
  });

  it("listAll includes SUPERSEDED rows only when asked", async () => {
    // Supersede jx-old directly in the table for this filter probe (the
    // transactional path is covered by the supersedePosted tests).
    await db
      .update(journal)
      .set({ status: "SUPERSEDED" })
      .where(eq(journal.id, `jx-old-${suffix}`));

    const postedOnly = await repo.listAll(householdA);
    expect(postedOnly.map((j) => j.id)).not.toContain(`jx-old-${suffix}`);

    const everything = await repo.listAll(householdA, { includeSuperseded: true });
    expect(everything.map((j) => j.id)).toEqual([
      `jx-dep-${suffix}`,
      `jx-buy-${suffix}`,
      `jx-dep2-${suffix}`,
      `jx-fee-${suffix}`,
      `jx-old-${suffix}`,
    ]);
    expect(everything.find((j) => j.id === `jx-old-${suffix}`)?.status).toBe("SUPERSEDED");

    await db
      .update(journal)
      .set({ status: "POSTED" })
      .where(eq(journal.id, `jx-old-${suffix}`));
  });

  it("listAll filters by type, account, and date range", async () => {
    const buys = await repo.listAll(householdA, { type: "BUY" });
    expect(buys.map((j) => j.id)).toEqual([`jx-buy-${suffix}`]);

    // jx-buy and jx-dep2 share 2024-01-10; only jx-buy touches investA.
    const investJournals = await repo.listAll(householdA, { accountId: investA });
    expect(investJournals.map((j) => j.id)).toEqual([`jx-buy-${suffix}`]);

    const january = await repo.listAll(householdA, { from: "2024-01-01", to: "2024-01-31" });
    expect(january.map((j) => j.id)).toEqual([
      `jx-dep-${suffix}`,
      `jx-buy-${suffix}`,
      `jx-dep2-${suffix}`,
    ]);

    const fromOnly = await repo.listAll(householdA, { from: "2024-02-01" });
    expect(fromOnly.map((j) => j.id)).toEqual([`jx-fee-${suffix}`, `jx-old-${suffix}`]);
  });

  it("listAll paginates with limit + cursor in replay order", async () => {
    const page1 = await repo.listAll(householdA, { limit: 2 });
    expect(page1.map((j) => j.id)).toEqual([`jx-dep-${suffix}`, `jx-buy-${suffix}`]);

    const last = page1[page1.length - 1]!;
    const cursor = encodeJournalCursor({
      tradeDate: last.tradeDate,
      sortKey: last.sortKey,
      id: last.id,
    });

    // Repo takes the decoded position; the tool layer owns the opaque string.
    const position = decodeJournalCursor(cursor)!;

    const page2 = await repo.listAll(householdA, { limit: 2, cursor: position });
    expect(page2.map((j) => j.id)).toEqual([`jx-dep2-${suffix}`, `jx-fee-${suffix}`]);

    const last2 = page2[page2.length - 1]!;
    const page3 = await repo.listAll(householdA, {
      limit: 2,
      cursor: { tradeDate: last2.tradeDate, sortKey: last2.sortKey, id: last2.id },
    });
    expect(page3.map((j) => j.id)).toEqual([`jx-old-${suffix}`]);
  });

  it("listAll never crosses households", async () => {
    const listedB = await repo.listAll(householdB);
    expect(listedB.map((j) => j.id)).toEqual([`jx-b-${suffix}`]);
  });

  it("getById returns the journal with postings — and null for a foreign id", async () => {
    const found = await repo.getById(householdA, `jx-buy-${suffix}`);
    expect(found?.id).toBe(`jx-buy-${suffix}`);
    expect(found?.type).toBe("BUY");
    expect(found?.postings).toHaveLength(2);
    const leg = found?.postings.find((p) => p.accountId === investA);
    expect(leg?.amount.minor).toBe(50_000n);
    expect(leg?.securityId).toBe("SEC-1");

    // Tenant isolation: household B asking for A's journal gets null,
    // indistinguishable from an unknown id.
    expect(await repo.getById(householdB, `jx-buy-${suffix}`)).toBeNull();
    expect(await repo.getById(householdA, `jx-nonexistent-${suffix}`)).toBeNull();
  });

  it("findByNaturalKey resolves within the household only", async () => {
    expect(await repo.findByNaturalKey(householdA, `stmt-fee-${suffix}`)).toBe(`jx-fee-${suffix}`);
    expect(await repo.findByNaturalKey(householdA, `stmt-missing-${suffix}`)).toBeNull();
    expect(await repo.findByNaturalKey(householdB, `stmt-fee-${suffix}`)).toBeNull();
  });

  it("nextSortKey is max POSTED sort_key + 1 for (household, trade_date), else 0", async () => {
    expect(await repo.nextSortKey(householdA, "2024-01-10")).toBe(2); // keys 0 and 1 exist
    expect(await repo.nextSortKey(householdA, "2024-01-05")).toBe(1); // key 0 exists
    expect(await repo.nextSortKey(householdA, "2030-12-31")).toBe(0); // untouched date
    expect(await repo.nextSortKey(householdB, "2024-01-10")).toBe(0); // B has no journals that day
  });

  it("nextSortKey ignores SUPERSEDED rows", async () => {
    await db
      .update(journal)
      .set({ status: "SUPERSEDED" })
      .where(eq(journal.id, `jx-dep-${suffix}`));
    expect(await repo.nextSortKey(householdA, "2024-01-05")).toBe(0);
    await db
      .update(journal)
      .set({ status: "POSTED" })
      .where(eq(journal.id, `jx-dep-${suffix}`));
  });

  it("supersedePosted flips the old row and inserts the replacement, linked", async () => {
    const replacement: Journal = {
      id: `jx-new-${suffix}`,
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      memo: "corrected amount",
      postings: [
        { accountId: extA, amount: money("CAD", -7_500n) },
        { accountId: cashA, amount: money("CAD", 7_500n) },
      ],
    };

    await repo.supersedePosted(householdA, `jx-old-${suffix}`, replacement);

    const old = await repo.getById(householdA, `jx-old-${suffix}`);
    expect(old?.status).toBe("SUPERSEDED");

    const inserted = await repo.getById(householdA, `jx-new-${suffix}`);
    expect(inserted?.status).toBe("POSTED");
    expect(inserted?.supersedesJournalId).toBe(`jx-old-${suffix}`);
    expect(inserted?.postings.map((p) => p.amount.minor).sort()).toEqual([-7_500n, 7_500n]);

    // Replay input is unaffected by history: replacement only.
    const posted = await repo.listPosted(householdA);
    expect(posted.map((j) => j.id)).toContain(`jx-new-${suffix}`);
    expect(posted.map((j) => j.id)).not.toContain(`jx-old-${suffix}`);

    expect(await repo.findSupersedingId(householdA, `jx-old-${suffix}`)).toBe(`jx-new-${suffix}`);
    expect(await repo.findSupersedingId(householdA, `jx-new-${suffix}`)).toBeNull();
  });

  it("supersedePosted rejects a non-POSTED target with NOT_POSTED", async () => {
    await expect(
      repo.supersedePosted(householdA, `jx-old-${suffix}`, {
        id: `jx-new2-${suffix}`,
        type: "DEPOSIT",
        tradeDate: "2024-03-02",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: extA, amount: money("CAD", -100n) },
          { accountId: cashA, amount: money("CAD", 100n) },
        ],
      }),
    ).rejects.toMatchObject({ name: "ValidationError", code: "NOT_POSTED" });
    expect(await repo.getById(householdA, `jx-new2-${suffix}`)).toBeNull();
  });

  it("supersedePosted rejects an unknown or foreign target with UNKNOWN_JOURNAL", async () => {
    const attempt = repo.supersedePosted(householdB, `jx-fee-${suffix}`, {
      id: `jx-evil-${suffix}`,
      type: "DEPOSIT",
      tradeDate: "2024-03-02",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: extB, amount: money("CAD", -100n) },
        { accountId: cashB, amount: money("CAD", 100n) },
      ],
    });
    await expect(attempt).rejects.toMatchObject({ name: "ValidationError", code: "UNKNOWN_JOURNAL" });
    // No mutation leaked across households.
    expect((await repo.getById(householdA, `jx-fee-${suffix}`))?.status).toBe("POSTED");
    expect(await repo.getById(householdB, `jx-evil-${suffix}`)).toBeNull();
  });

  it("supersedePosted rolls the status flip back when the replacement insert fails", async () => {
    // jx-dep2 is POSTED at (2024-01-10, sortKey 1): the replacement below
    // collides with the partial unique index on POSTED rows.
    const colliding: Journal = {
      id: `jx-collide-${suffix}`,
      type: "DEPOSIT",
      tradeDate: "2024-01-10",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: extA, amount: money("CAD", -100n) },
        { accountId: cashA, amount: money("CAD", 100n) },
      ],
    };

    await expect(
      repo.supersedePosted(householdA, `jx-fee-${suffix}`, colliding),
    ).rejects.toThrow();

    // The transaction rolled back: fee stays POSTED, no partial insert.
    expect((await repo.getById(householdA, `jx-fee-${suffix}`))?.status).toBe("POSTED");
    expect(await repo.getById(householdA, `jx-collide-${suffix}`)).toBeNull();
  });

  it("insertPosted and listPosted behaviour is unchanged", async () => {
    const posted = await repo.listPosted(householdA);
    expect(posted.every((j) => j.status === "POSTED")).toBe(true);
    expect(posted.map((j) => j.id).sort()).toEqual(
      [
        `jx-dep-${suffix}`,
        `jx-buy-${suffix}`,
        `jx-dep2-${suffix}`,
        `jx-fee-${suffix}`,
        `jx-new-${suffix}`,
      ].sort(),
    );

    await expect(
      repo.insertPosted(
        { ...posted[0]!, id: `jx-draft-${suffix}`, status: "SUPERSEDED" },
        householdA,
      ),
    ).rejects.toThrow("insertPosted requires POSTED status");
  });

  it("throws ValidationError instances (mapped to tool errors by the MCP layer)", async () => {
    const err = await repo
      .supersedePosted(householdA, `jx-old-${suffix}`, {
        id: `jx-any-${suffix}`,
        type: "DEPOSIT",
        tradeDate: "2024-03-03",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: extA, amount: money("CAD", -1n) },
          { accountId: cashA, amount: money("CAD", 1n) },
        ],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });
});
