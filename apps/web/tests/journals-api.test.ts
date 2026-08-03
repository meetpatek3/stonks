import { describe, expect, it, vi } from "vitest";
import type { Account, Journal } from "@stonks/ledger";
import {
  createPostedJournal,
  decimalAmountToMinorString,
  mostRecentlyUsedAccountId,
  todayIsoDate,
  type CreateJournalContext,
} from "@/lib/journals";

const CASH = "cash-1";
const EXT = "ext-1";
const FOREIGN_CASH = "cash-other-hh";

const householdAccounts = new Map<string, Account>([
  [CASH, { id: CASH, type: "CASH", currency: "CAD" }],
  [EXT, { id: EXT, type: "EXTERNAL", currency: "CAD" }],
]);

function depositBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "DEPOSIT",
    tradeDate: "2024-06-15",
    memo: "paycheck",
    postings: [
      { accountId: EXT, amountMinor: "-100000" },
      { accountId: CASH, amountMinor: "100000" },
    ],
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<CreateJournalContext> = {},
): CreateJournalContext & { inserted: Journal[] } {
  const inserted: Journal[] = [];
  return {
    householdId: "hh-1",
    accounts: householdAccounts,
    reportingCurrency: "CAD",
    nextSortKeyForDate: vi.fn(async () => 0),
    insertPosted: vi.fn(async (journal: Journal) => {
      inserted.push(journal);
    }),
    newId: () => "j-test-1",
    inserted,
    ...overrides,
  };
}

describe("createPostedJournal", () => {
  it("accepts a balanced journal and persists it with server-assigned sortKey", async () => {
    const ctx = makeCtx({
      nextSortKeyForDate: vi.fn(async () => 7),
    });

    const result = await createPostedJournal(depositBody(), ctx);

    expect(result).toEqual({ ok: true, id: "j-test-1" });
    expect(ctx.insertPosted).toHaveBeenCalledTimes(1);
    expect(ctx.inserted).toHaveLength(1);

    const journal = ctx.inserted[0]!;
    expect(journal.id).toBe("j-test-1");
    expect(journal.type).toBe("DEPOSIT");
    expect(journal.tradeDate).toBe("2024-06-15");
    expect(journal.sortKey).toBe(7);
    expect(journal.status).toBe("POSTED");
    expect(journal.source).toBe("MANUAL");
    expect(journal.memo).toBe("paycheck");
    expect(journal.postings).toHaveLength(2);
    expect(journal.postings[0]!.amount.minor).toBe(-100_000n);
    expect(journal.postings[1]!.amount.minor).toBe(100_000n);
    expect(journal.postings[0]!.amount.currency).toBe("CAD");
    // Client must not control replay order.
    expect(ctx.nextSortKeyForDate).toHaveBeenCalledWith("2024-06-15");
  });

  it("rejects an unbalanced journal with 400 and the ledger message", async () => {
    const ctx = makeCtx();

    const result = await createPostedJournal(
      depositBody({
        postings: [
          { accountId: EXT, amountMinor: "-100000" },
          { accountId: CASH, amountMinor: "99999" },
        ],
      }),
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe("Journal postings do not sum to zero");
    expect(ctx.insertPosted).not.toHaveBeenCalled();
  });

  it("rejects a request naming another household's account", async () => {
    const ctx = makeCtx();

    const result = await createPostedJournal(
      depositBody({
        postings: [
          { accountId: EXT, amountMinor: "-50000" },
          { accountId: FOREIGN_CASH, amountMinor: "50000" },
        ],
      }),
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/unknown account|not in this household/i);
    expect(result.error).toContain(FOREIGN_CASH);
    expect(ctx.insertPosted).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied sortKey without writing", async () => {
    const ctx = makeCtx();

    const result = await createPostedJournal(
      depositBody({ sortKey: 99 }),
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/sortKey/i);
    expect(ctx.insertPosted).not.toHaveBeenCalled();
  });

  it("rejects amountMinor sent as a JSON number", async () => {
    const ctx = makeCtx();

    const result = await createPostedJournal(
      depositBody({
        postings: [
          { accountId: EXT, amountMinor: -100000 },
          { accountId: CASH, amountMinor: 100000 },
        ],
      }),
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/amountMinor/i);
    expect(result.error).toMatch(/string/i);
    expect(ctx.insertPosted).not.toHaveBeenCalled();
  });
});

describe("decimalAmountToMinorString", () => {
  it("converts a plain amount at the currency scale", () => {
    expect(decimalAmountToMinorString("1000.00", 2)).toBe("100000");
    expect(decimalAmountToMinorString("12.34", 2)).toBe("1234");
  });

  it("rounds half away from zero when there are more decimals than the scale", () => {
    // Hand-calculated: 10.005 at scale 2 → 10.01 → 1001 minors.
    expect(decimalAmountToMinorString("10.005", 2)).toBe("1001");
    expect(decimalAmountToMinorString("10.004", 2)).toBe("1000");
    expect(decimalAmountToMinorString("-10.005", 2)).toBe("-1001");
  });

  it("returns null for a non-decimal amount", () => {
    expect(decimalAmountToMinorString("1e3", 2)).toBeNull();
    expect(decimalAmountToMinorString("abc", 2)).toBeNull();
  });
});

describe("todayIsoDate", () => {
  it("formats the local calendar date as YYYY-MM-DD", () => {
    expect(todayIsoDate(new Date(2026, 7, 3, 15, 30, 0))).toBe("2026-08-03");
  });
});

describe("mostRecentlyUsedAccountId", () => {
  it("returns the latest non-EXTERNAL posting account by tradeDate then sortKey", () => {
    const journals: Journal[] = [
      {
        id: "j1",
        type: "DEPOSIT",
        tradeDate: "2024-01-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: EXT, amount: { currency: "CAD", minor: -10_000n } },
          { accountId: CASH, amount: { currency: "CAD", minor: 10_000n } },
        ],
      },
      {
        id: "j2",
        type: "TRANSFER",
        tradeDate: "2024-06-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: CASH, amount: { currency: "CAD", minor: -5_000n } },
          {
            accountId: "inv-1",
            amount: { currency: "CAD", minor: 5_000n },
          },
        ],
      },
    ];

    expect(
      mostRecentlyUsedAccountId(journals, new Set([CASH, "inv-1", EXT])),
    ).toBe("inv-1");
  });

  it("skips SUPERSEDED journals and EXTERNAL-only postings", () => {
    const journals: Journal[] = [
      {
        id: "j-old",
        type: "DEPOSIT",
        tradeDate: "2024-06-02",
        sortKey: 0,
        status: "SUPERSEDED",
        source: "MANUAL",
        postings: [
          { accountId: EXT, amount: { currency: "CAD", minor: -1n } },
          { accountId: "gone", amount: { currency: "CAD", minor: 1n } },
        ],
      },
      {
        id: "j-live",
        type: "DEPOSIT",
        tradeDate: "2024-01-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: EXT, amount: { currency: "CAD", minor: -2n } },
          { accountId: CASH, amount: { currency: "CAD", minor: 2n } },
        ],
      },
    ];

    expect(mostRecentlyUsedAccountId(journals, new Set([CASH, EXT]))).toBe(
      CASH,
    );
  });
});
