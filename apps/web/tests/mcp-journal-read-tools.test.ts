import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import type { AccountRecord, JournalListFilters } from "@stonks/db";
import { invokeTool } from "@/lib/mcp/registrar";
import { getJournalTool, listJournalsTool } from "@/lib/mcp/tools/journals-read";
import { assertMoneyFieldsAreStrings, makeTestCtx } from "./helpers/mcp-test-utils";

/**
 * Task 6 read tools: list_journals and get_journal (spec §8 tools 4–5).
 *
 * The fake repo below is a faithful in-memory implementation of the Task 4
 * `JournalRepo` read interface over two households. Expected orderings and
 * page contents are derived from the fixture journals by hand.
 */

function deposit(id: string, sortKey: number, minor: bigint): Journal {
  return {
    id,
    type: "DEPOSIT",
    tradeDate: "2024-01-05",
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "world", amount: money("CAD", -minor) },
      { accountId: "cash", amount: money("CAD", minor) },
    ],
  };
}

/** Buy 100 XEQT for 2,500.00 CAD. */
const j2Buy: Journal = {
  id: "j2-buy",
  type: "BUY",
  tradeDate: "2024-01-10",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 250_000n),
      quantity: qtyFromDecimalString("100"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: 250_000n,
    },
    { accountId: "cash", amount: money("CAD", -250_000n) },
  ],
};

/** Interest charge with INVESTMENT facility-use attribution. */
const j4Interest: Journal = {
  id: "j4-interest",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-02-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "cash", amount: money("CAD", -5_000n) },
    { accountId: "world", amount: money("CAD", 5_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 5_000n) }],
};

/** Buy 50 MSFT for US$2,000.00 at 27/20 (1.35) = 2,700.00 CAD reporting. */
const j7FxBuy: Journal = {
  id: "j7-fx-buy",
  type: "BUY",
  tradeDate: "2024-02-15",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 270_000n),
      quantity: qtyFromDecimalString("50"),
      securityId: "MSFT",
      tradeCurrency: "USD",
      tradeAmountMinor: 200_000n,
      fxRateN: 27n,
      fxRateD: 20n,
    },
    { accountId: "cash", amount: money("CAD", -270_000n) },
  ],
};

/** The superseded original fee… */
const j5FeeOld: Journal = {
  id: "j5-fee-old",
  type: "FEE",
  tradeDate: "2024-03-01",
  sortKey: 0,
  status: "SUPERSEDED",
  source: "MANUAL",
  memo: "wrong fee",
  postings: [
    { accountId: "cash", amount: money("CAD", -1_000n) },
    { accountId: "world", amount: money("CAD", 1_000n) },
  ],
};

/** …and its POSTED replacement, linked by supersedesJournalId. */
const j6FeeNew: Journal = {
  id: "j6-fee-new",
  type: "FEE",
  tradeDate: "2024-03-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  memo: "corrected fee",
  supersedesJournalId: "j5-fee-old",
  postings: [
    { accountId: "cash", amount: money("CAD", -2_000n) },
    { accountId: "world", amount: money("CAD", 2_000n) },
  ],
};

const JOURNALS_A: Journal[] = [
  deposit("j1-deposit", 0, 500_000n),
  j2Buy,
  { ...deposit("j3-deposit", 1, 100_000n), tradeDate: "2024-01-10" },
  j4Interest,
  j7FxBuy,
  j5FeeOld,
  j6FeeNew,
];

const JOURNALS_B: Journal[] = [
  {
    id: "jb1-deposit",
    type: "DEPOSIT",
    tradeDate: "2024-01-05",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "acct-b-world", amount: money("CAD", -700_000n) },
      { accountId: "acct-b-cash", amount: money("CAD", 700_000n) },
    ],
  },
];

const ACCOUNTS_A: AccountRecord[] = ["brokerage", "cash", "facility", "world"].map((id) => ({
  id,
  name: id,
  type: "CASH",
  currency: "CAD",
  minorUnits: 2,
  taxTreatment: null,
  closedAt: null,
}));

function fakeJournals(byHousehold: Map<string, Journal[]>) {
  const calls: { method: string; householdId: string; filters?: JournalListFilters }[] = [];
  return {
    calls,
    listAll: async (householdId: string, filters: JournalListFilters = {}) => {
      calls.push({ method: "listAll", householdId, filters });
      let rows = (byHousehold.get(householdId) ?? []).slice();
      if (!filters.includeSuperseded) rows = rows.filter((j) => j.status === "POSTED");
      if (filters.type) rows = rows.filter((j) => j.type === filters.type);
      if (filters.accountId) {
        rows = rows.filter((j) => j.postings.some((p) => p.accountId === filters.accountId));
      }
      if (filters.from) rows = rows.filter((j) => j.tradeDate >= filters.from!);
      if (filters.to) rows = rows.filter((j) => j.tradeDate <= filters.to!);
      rows.sort(
        (a, b) =>
          a.tradeDate.localeCompare(b.tradeDate) ||
          a.sortKey - b.sortKey ||
          a.id.localeCompare(b.id),
      );
      if (filters.cursor) {
        const c = filters.cursor;
        rows = rows.filter(
          (j) =>
            j.tradeDate > c.tradeDate ||
            (j.tradeDate === c.tradeDate &&
              (j.sortKey > c.sortKey || (j.sortKey === c.sortKey && j.id > c.id))),
        );
      }
      if (filters.limit !== undefined) rows = rows.slice(0, filters.limit);
      return rows;
    },
    getById: async (householdId: string, id: string) => {
      calls.push({ method: "getById", householdId });
      return (byHousehold.get(householdId) ?? []).find((j) => j.id === id) ?? null;
    },
    findSupersedingId: async (householdId: string, journalId: string) => {
      calls.push({ method: "findSupersedingId", householdId });
      return (
        (byHousehold.get(householdId) ?? []).find((j) => j.supersedesJournalId === journalId)
          ?.id ?? null
      );
    },
  };
}

function fakeAccounts() {
  const byHousehold = new Map<string, AccountRecord[]>([
    ["hh-a", ACCOUNTS_A],
    [
      "hh-b",
      [
        {
          id: "acct-b-cash",
          name: "B cash",
          type: "CASH",
          currency: "CAD",
          minorUnits: 2,
          taxTreatment: null,
          closedAt: null,
        },
      ],
    ],
  ]);
  return {
    list: async (householdId: string) => byHousehold.get(householdId) ?? [],
    getById: async (householdId: string, id: string) =>
      (byHousehold.get(householdId) ?? []).find((row) => row.id === id) ?? null,
    getCurrency: async () => null,
    create: async (): Promise<AccountRecord> => {
      throw new Error("not used by journal read tools");
    },
    close: async () => null,
  };
}

const journals = () => fakeJournals(new Map([["hh-a", JOURNALS_A], ["hh-b", JOURNALS_B]]));

const ctxFor = (j: ReturnType<typeof fakeJournals>, householdId = "hh-a") =>
  makeTestCtx({ householdId, repos: { journals: j, accounts: fakeAccounts() } });

type Wire = { id: string; status: string; [k: string]: unknown };
const ids = (result: { structuredContent?: Record<string, unknown> }) =>
  (result.structuredContent as { journals: Wire[] }).journals.map((j) => j.id);

describe("list_journals", () => {
  it("excludes superseded journals by default, in (tradeDate, sortKey, id) order", async () => {
    const result = await invokeTool(listJournalsTool, ctxFor(journals()), {});

    expect(result.isError).toBeUndefined();
    assertMoneyFieldsAreStrings(result.structuredContent);
    expect(ids(result)).toEqual([
      "j1-deposit",
      "j2-buy",
      "j3-deposit",
      "j4-interest",
      "j7-fx-buy",
      "j6-fee-new",
    ]);
    expect(result.structuredContent).toMatchObject({ nextCursor: null });
  });

  it("marks superseded rows with status and keeps the supersedesJournalId link when asked", async () => {
    const result = await invokeTool(listJournalsTool, ctxFor(journals()), {
      includeSuperseded: true,
    });

    const rows = (result.structuredContent as { journals: Wire[] }).journals;
    expect(ids(result)).toContain("j5-fee-old");
    const old = rows.find((j) => j.id === "j5-fee-old")!;
    const replacement = rows.find((j) => j.id === "j6-fee-new")!;
    expect(old.status).toBe("SUPERSEDED");
    expect(replacement).toMatchObject({ status: "POSTED", supersedesJournalId: "j5-fee-old" });
  });

  it("passes type, account, and date-range filters through to the repo", async () => {
    const j = journals();

    const byType = await invokeTool(listJournalsTool, ctxFor(j), { type: "BUY" });
    expect(ids(byType)).toEqual(["j2-buy", "j7-fx-buy"]);

    const byAccount = await invokeTool(listJournalsTool, ctxFor(j), { accountId: "brokerage" });
    expect(ids(byAccount)).toEqual(["j2-buy", "j7-fx-buy"]);

    const byRange = await invokeTool(listJournalsTool, ctxFor(j), {
      from: "2024-01-10",
      to: "2024-02-01",
    });
    expect(ids(byRange)).toEqual(["j2-buy", "j3-deposit", "j4-interest"]);

    const filters = j.calls.filter((c) => c.method === "listAll").map((c) => c.filters);
    expect(filters[1]).toMatchObject({ accountId: "brokerage", includeSuperseded: false });
    expect(filters[2]).toMatchObject({ from: "2024-01-10", to: "2024-02-01" });
  });

  it("rejects another household's account id with UNKNOWN_ACCOUNT", async () => {
    const result = await invokeTool(listJournalsTool, ctxFor(journals()), {
      accountId: "acct-b-cash",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "UNKNOWN_ACCOUNT" });
  });

  it("honours limit and round-trips the opaque cursor with no overlap", async () => {
    const j = journals();

    const page1 = await invokeTool(listJournalsTool, ctxFor(j), { limit: 2 });
    expect(ids(page1)).toEqual(["j1-deposit", "j2-buy"]);
    const cursor1 = (page1.structuredContent as { nextCursor: string | null }).nextCursor;
    expect(cursor1).toEqual(expect.any(String));

    const page2 = await invokeTool(listJournalsTool, ctxFor(j), { limit: 2, cursor: cursor1! });
    expect(ids(page2)).toEqual(["j3-deposit", "j4-interest"]);
    const cursor2 = (page2.structuredContent as { nextCursor: string | null }).nextCursor;
    expect(cursor2).toEqual(expect.any(String));

    const page3 = await invokeTool(listJournalsTool, ctxFor(j), { limit: 2, cursor: cursor2! });
    expect(ids(page3)).toEqual(["j7-fx-buy", "j6-fee-new"]);
    expect((page3.structuredContent as { nextCursor: string | null }).nextCursor).toBeNull();

    const all = [...ids(page1), ...ids(page2), ...ids(page3)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("rejects a malformed cursor with INVALID_INPUT naming the field", async () => {
    const result = await invokeTool(listJournalsTool, ctxFor(journals()), {
      cursor: "not-a-cursor",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(result)).toContain("cursor");
  });

  it("emits postings with minor-string amounts, decimal quantities and rational FX strings", async () => {
    const result = await invokeTool(listJournalsTool, ctxFor(journals()), { type: "BUY" });
    const fx = (result.structuredContent as { journals: Wire[] }).journals.find(
      (row) => row.id === "j7-fx-buy",
    )!;
    const posting = (fx.postings as Array<Record<string, unknown>>)[0]!;
    expect(posting).toMatchObject({
      accountId: "brokerage",
      amountMinor: "270000",
      currency: "CAD",
      quantity: "50.00000000",
      securityId: "MSFT",
      tradeCurrency: "USD",
      tradeAmountMinor: "200000",
      fxRateN: "27",
      fxRateD: "20",
    });
    for (const key of ["amountMinor", "quantity", "tradeAmountMinor", "fxRateN", "fxRateD"]) {
      expect(typeof posting[key], key).toBe("string");
    }
  });

  it("is scoped to the token's household: A's list never contains B's journals", async () => {
    const j = journals();
    const result = await invokeTool(listJournalsTool, ctxFor(j, "hh-a"), {
      includeSuperseded: true,
    });
    expect(ids(result)).not.toContain("jb1-deposit");
    expect(j.calls.every((c) => c.householdId === "hh-a")).toBe(true);
  });
});

describe("get_journal", () => {
  it("returns the full journal with postings and an empty supersession chain", async () => {
    const result = await invokeTool(getJournalTool, ctxFor(journals()), { journalId: "j7-fx-buy" });

    expect(result.isError).toBeUndefined();
    assertMoneyFieldsAreStrings(result.structuredContent);
    const out = result.structuredContent as {
      journal: Wire;
      supersession: Record<string, unknown>;
    };
    expect(out.journal).toMatchObject({
      id: "j7-fx-buy",
      type: "BUY",
      tradeDate: "2024-02-15",
      status: "POSTED",
      supersedesJournalId: null,
    });
    expect(out.supersession).toEqual({
      supersedesJournalId: null,
      supersededByJournalId: null,
    });
  });

  it("carries facility uses with minor-string amounts", async () => {
    const result = await invokeTool(getJournalTool, ctxFor(journals()), {
      journalId: "j4-interest",
    });
    const out = result.structuredContent as { journal: Wire };
    expect(out.journal.facilityUses).toEqual([
      { use: "INVESTMENT", amountMinor: "5000", currency: "CAD" },
    ]);
  });

  it("resolves the supersession chain in both directions", async () => {
    const j = journals();

    const replacement = await invokeTool(getJournalTool, ctxFor(j), { journalId: "j6-fee-new" });
    expect(replacement.structuredContent).toMatchObject({
      supersession: { supersedesJournalId: "j5-fee-old", supersededByJournalId: null },
    });

    const old = await invokeTool(getJournalTool, ctxFor(j), { journalId: "j5-fee-old" });
    expect(old.structuredContent).toMatchObject({
      journal: { id: "j5-fee-old", status: "SUPERSEDED" },
      supersession: { supersedesJournalId: null, supersededByJournalId: "j6-fee-new" },
    });
  });

  it("returns UNKNOWN_JOURNAL for an unknown id — a structured error, not a throw", async () => {
    const result = await invokeTool(getJournalTool, ctxFor(journals()), { journalId: "j-nope" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "UNKNOWN_JOURNAL" });
    expect(JSON.stringify(result)).toContain("j-nope");
  });

  it("returns UNKNOWN_JOURNAL for another household's valid journal id — never B's data", async () => {
    const j = journals();
    const result = await invokeTool(getJournalTool, ctxFor(j, "hh-a"), {
      journalId: "jb1-deposit",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "UNKNOWN_JOURNAL" });
    // The lookup itself was household-scoped: the repo saw ("hh-a", "jb1-deposit").
    expect(j.calls.find((c) => c.method === "getById")).toMatchObject({ householdId: "hh-a" });
    expect(JSON.stringify(result)).not.toContain("700000");
  });
});

describe("annotations and scope", () => {
  it.each([
    ["list_journals", listJournalsTool],
    ["get_journal", getJournalTool],
  ])("%s is a read-scoped, read-only tool", (name, tool) => {
    expect(tool.name).toBe(name);
    expect(tool.scope).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });
});
