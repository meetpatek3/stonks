import { describe, expect, it } from "vitest";
import {
  ValidationError,
  money,
  qtyFromDecimalString,
  type Journal,
} from "@stonks/ledger";
import type { AccountRecord, JournalListFilters } from "@stonks/db";
import { invokeTool, type AnyToolDefinition } from "@/lib/mcp/registrar";
import { getJournalTool } from "@/lib/mcp/tools/journals-read";
import { recordJournalTool, supersedeJournalTool } from "@/lib/mcp/tools/journals-write";
import { assertMoneyFieldsAreStrings, makeTestCtx } from "./helpers/mcp-test-utils";

/**
 * Task 7 write tools: record_journal and supersede_journal (spec §8 tools
 * 13–14). The fakes below are faithful in-memory implementations of the
 * journal write/read repo interfaces over two households, sharing one store
 * so a supersession is observable through the read side afterwards. All
 * expectations are hand-derived from the fixtures — no snapshots.
 */

const ACCOUNTS_A: AccountRecord[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  { id: "cash", name: "Cash", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  { id: "facility", name: "Margin", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  { id: "world", name: "External", type: "EXTERNAL", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
];

const ACCOUNTS_B: AccountRecord[] = [
  { id: "acct-b-cash", name: "B cash", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
];

function fakeAccounts(byHousehold: Map<string, AccountRecord[]>) {
  return {
    list: async (householdId: string) => byHousehold.get(householdId) ?? [],
    getById: async (householdId: string, id: string) =>
      (byHousehold.get(householdId) ?? []).find((row) => row.id === id) ?? null,
    getCurrency: async () => null,
    create: async (): Promise<AccountRecord> => {
      throw new Error("not used by journal tools");
    },
    close: async () => null,
  };
}

const accounts = () =>
  fakeAccounts(
    new Map([
      ["hh-a", ACCOUNTS_A],
      ["hh-b", ACCOUNTS_B],
    ]),
  );

/** A POSTED deposit on 2024-01-05 (sortKey 0) and one on 2024-01-10 (sortKey 0). */
function seedJournals(): Journal[] {
  return [
    {
      id: "j-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-01-05",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "world", amount: money("CAD", -500_000n) },
        { accountId: "cash", amount: money("CAD", 500_000n) },
      ],
    },
    {
      id: "j-deposit-2",
      type: "DEPOSIT",
      tradeDate: "2024-01-10",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      externalNaturalKey: "stmt-2024-01-10-row-1",
      postings: [
        { accountId: "world", amount: money("CAD", -100_000n) },
        { accountId: "cash", amount: money("CAD", 100_000n) },
      ],
    },
  ];
}

function fakeJournalStore(seed: Map<string, Journal[]>) {
  // Deep-copy the seed so tests never share mutable journal state.
  const store = new Map<string, Journal[]>(
    [...seed.entries()].map(([hh, rows]) => [hh, rows.map((row) => ({ ...row }))]),
  );
  const naturalKeys = new Map<string, string>();
  for (const [hh, rows] of store) {
    for (const row of rows) {
      if (row.externalNaturalKey) naturalKeys.set(`${hh}|${row.externalNaturalKey}`, row.id);
    }
  }

  const calls: Array<{ method: string; householdId: string; detail?: unknown }> = [];

  const read = {
    listAll: async (householdId: string, filters: JournalListFilters = {}) => {
      let rows = (store.get(householdId) ?? []).slice();
      if (!filters.includeSuperseded) rows = rows.filter((j) => j.status === "POSTED");
      return rows;
    },
    getById: async (householdId: string, id: string) =>
      (store.get(householdId) ?? []).find((j) => j.id === id) ?? null,
    findSupersedingId: async (householdId: string, journalId: string) =>
      (store.get(householdId) ?? []).find((j) => j.supersedesJournalId === journalId)?.id ??
      null,
  };

  const write = {
    insertPosted: async (journal: Journal, householdId: string) => {
      calls.push({ method: "insertPosted", householdId, detail: journal });
      store.get(householdId)!.push(journal);
      if (journal.externalNaturalKey) {
        naturalKeys.set(`${householdId}|${journal.externalNaturalKey}`, journal.id);
      }
    },
    nextSortKey: async (householdId: string, tradeDate: string) => {
      calls.push({ method: "nextSortKey", householdId, detail: tradeDate });
      const keys = (store.get(householdId) ?? [])
        .filter((j) => j.tradeDate === tradeDate && j.status === "POSTED")
        .map((j) => j.sortKey);
      return keys.length === 0 ? 0 : Math.max(...keys) + 1;
    },
    findByNaturalKey: async (householdId: string, key: string) =>
      naturalKeys.get(`${householdId}|${key}`) ?? null,
    supersedePosted: async (householdId: string, oldId: string, replacement: Journal) => {
      calls.push({ method: "supersedePosted", householdId, detail: { oldId, replacement } });
      const rows = store.get(householdId) ?? [];
      const old = rows.find((j) => j.id === oldId);
      if (!old) {
        throw new ValidationError(
          `Unknown journal in this household: ${oldId}`,
          "UNKNOWN_JOURNAL",
          [oldId],
        );
      }
      if (old.status !== "POSTED") {
        throw new ValidationError(
          `Journal ${oldId} is ${old.status}; only a POSTED journal can be superseded`,
          "NOT_POSTED",
          [oldId],
        );
      }
      old.status = "SUPERSEDED";
      rows.push({ ...replacement, supersedesJournalId: oldId });
    },
  };

  return { store, calls, read, write };
}

const JOURNALS_B: Journal[] = [
  {
    id: "jb1-deposit",
    type: "DEPOSIT",
    tradeDate: "2024-01-05",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "acct-b-cash", amount: money("CAD", 700_000n) },
      { accountId: "acct-b-cash", amount: money("CAD", -700_000n) },
    ],
  },
];

function ctxFor(store: ReturnType<typeof fakeJournalStore>, householdId = "hh-a") {
  return makeTestCtx({
    householdId,
    scope: "read_write",
    repos: { journals: store.read, journalWrites: store.write, accounts: accounts() },
  });
}

/** Buy 100 XEQT for 2,500.00 CAD. */
const BUY_INPUT = {
  type: "BUY",
  tradeDate: "2024-01-10",
  memo: "Buy XEQT",
  postings: [
    {
      accountId: "brokerage",
      amountMinor: "250000",
      currency: "CAD",
      quantity: "100",
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: "250000",
    },
    { accountId: "cash", amountMinor: "-250000" },
  ],
};

type Ok = { structuredContent?: Record<string, unknown> };
const ok = (result: Ok) => {
  expect(result, JSON.stringify(result)).not.toMatchObject({ isError: true });
  return result.structuredContent as Record<string, unknown>;
};
const err = (result: { isError?: boolean; structuredContent?: Record<string, unknown> }) => {
  expect(result.isError).toBe(true);
  return result.structuredContent as { code: string; message: string; hint?: string };
};

describe("record_journal", () => {
  it("accepts a balanced BUY journal and persists it with bigint/Quantity conversions only", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), BUY_INPUT);

    const out = ok(result);
    assertMoneyFieldsAreStrings(out);
    expect(out.duplicate).toBe(false);
    expect(typeof out.journalId).toBe("string");

    const inserts = store.calls.filter((c) => c.method === "insertPosted");
    expect(inserts).toHaveLength(1);
    const journal = inserts[0]!.detail as Journal;
    expect(journal).toMatchObject({
      id: out.journalId,
      type: "BUY",
      tradeDate: "2024-01-10",
      // Server-assigned: one POSTED journal already exists on that date.
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      memo: "Buy XEQT",
    });
    // Money reached the repo as bigint, quantity as a Quantity — parsed via
    // BigInt/qtyFromDecimalString only.
    expect(journal.postings[0]!.amount.minor).toBe(250_000n);
    expect(journal.postings[0]!.quantity).toEqual(qtyFromDecimalString("100"));
    expect(journal.postings[0]!.tradeAmountMinor).toBe(250_000n);
    expect(journal.postings[1]!.amount.minor).toBe(-250_000n);

    const wire = out.journal as { postings: Array<Record<string, unknown>> };
    expect(wire.postings[0]).toMatchObject({
      accountId: "brokerage",
      amountMinor: "250000",
      currency: "CAD",
      quantity: "100.00000000",
      securityId: "XEQT",
    });
  });

  it("rejects an unbalanced journal with UNBALANCED_JOURNAL and writes nothing", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "DEPOSIT",
      tradeDate: "2024-01-11",
      postings: [
        { accountId: "world", amountMinor: "-50000" },
        { accountId: "cash", amountMinor: "49999" },
      ],
    });

    const out = err(result);
    expect(out.code).toBe("UNBALANCED_JOURNAL");
    expect(out.message).toContain("do not sum to zero");
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
  });

  it("rejects a facility draw without 100% facility-use lines as FACILITY_USE_INCOMPLETE", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const draw = {
      type: "TRANSFER",
      tradeDate: "2024-01-12",
      postings: [
        { accountId: "facility", amountMinor: "-100000" },
        { accountId: "brokerage", amountMinor: "100000" },
      ],
    };

    const missing = err(await invokeTool(recordJournalTool, ctxFor(store), draw));
    expect(missing.code).toBe("FACILITY_USE_INCOMPLETE");

    const partial = err(
      await invokeTool(recordJournalTool, ctxFor(store), {
        ...draw,
        facilityUses: [{ use: "INVESTMENT", amountMinor: "50000" }],
      }),
    );
    expect(partial.code).toBe("FACILITY_USE_INCOMPLETE");
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
  });

  it("accepts a facility draw whose use lines sum to the draw amount", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "TRANSFER",
      tradeDate: "2024-01-12",
      postings: [
        { accountId: "facility", amountMinor: "-100000" },
        { accountId: "brokerage", amountMinor: "100000" },
      ],
      facilityUses: [
        { use: "INVESTMENT", amountMinor: "70000" },
        { use: "PERSONAL", amountMinor: "30000" },
      ],
    });

    const out = ok(result);
    assertMoneyFieldsAreStrings(out);
    const journal = (out.journal ?? {}) as Record<string, unknown>;
    expect(journal.facilityUses).toEqual([
      { use: "INVESTMENT", amountMinor: "70000", currency: "CAD" },
      { use: "PERSONAL", amountMinor: "30000", currency: "CAD" },
    ]);
  });

  it("rejects amountMinor as a JSON number at the schema boundary, naming the field", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "DEPOSIT",
      tradeDate: "2024-01-11",
      postings: [
        { accountId: "world", amountMinor: -50000 },
        { accountId: "cash", amountMinor: "50000" },
      ],
    });

    const out = err(result);
    expect(out.code).toBe("INVALID_INPUT");
    expect(out.message).toContain("postings.0.amountMinor");
    expect(out.message).toContain("string");
    expect(store.calls).toHaveLength(0);
  });

  it("returns the existing journal id with duplicate: true for a known externalNaturalKey", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "DEPOSIT",
      tradeDate: "2024-01-10",
      externalNaturalKey: "stmt-2024-01-10-row-1",
      postings: [
        { accountId: "world", amountMinor: "-100000" },
        { accountId: "cash", amountMinor: "100000" },
      ],
    });

    const out = ok(result);
    expect(out).toMatchObject({ duplicate: true, journalId: "j-deposit-2" });
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
    // One journal on that natural key — never posted twice.
    expect(store.store.get("hh-a")!.filter((j) => j.externalNaturalKey)).toHaveLength(1);
  });

  it("accepts an OPENING with quantity and no cost, leaving cost absent (never zero-substituted)", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "OPENING",
      tradeDate: "2024-01-02",
      postings: [
        { accountId: "brokerage", amountMinor: "0", quantity: "50", securityId: "ACME" },
        { accountId: "world", amountMinor: "0" },
      ],
    });

    const out = ok(result);
    const wire = out.journal as { postings: Array<Record<string, unknown>> };
    expect(wire.postings[0]).toMatchObject({
      quantity: "50.00000000",
      securityId: "ACME",
      tradeAmountMinor: null,
      fxRateN: null,
      fxRateD: null,
    });
  });

  it("rejects a client-supplied sortKey and never honours it", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      ...BUY_INPUT,
      sortKey: 0,
    });

    const out = err(result);
    expect(out.code).toBe("INVALID_INPUT");
    expect(out.message).toContain("sortKey");
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
  });

  it("rejects a posting in another household's account and writes nothing", async () => {
    const store = fakeJournalStore(
      new Map([
        ["hh-a", seedJournals()],
        ["hh-b", JOURNALS_B.map((j) => ({ ...j }))],
      ]),
    );
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "DEPOSIT",
      tradeDate: "2024-01-11",
      postings: [
        { accountId: "world", amountMinor: "-50000" },
        { accountId: "acct-b-cash", amountMinor: "50000" },
      ],
    });

    const out = err(result);
    expect(out.code).toBe("UNKNOWN_ACCOUNT");
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
    expect(store.store.get("hh-b")).toHaveLength(1);
  });

  it("rejects a posting currency that is not the household reporting currency", async () => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const result = await invokeTool(recordJournalTool, ctxFor(store), {
      type: "DEPOSIT",
      tradeDate: "2024-01-11",
      postings: [
        { accountId: "world", amountMinor: "-50000", currency: "USD" },
        { accountId: "cash", amountMinor: "50000" },
      ],
    });

    const out = err(result);
    expect(out.code).toBe("VALIDATION");
    expect(out.message).toContain("USD");
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
  });
});

describe("supersede_journal", () => {
  const oldFee = (): Journal => ({
    id: "j-fee-old",
    type: "FEE",
    tradeDate: "2024-03-01",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    memo: "wrong fee",
    postings: [
      { accountId: "cash", amount: money("CAD", -1_000n) },
      { accountId: "world", amount: money("CAD", 1_000n) },
    ],
  });

  const CORRECTED_FEE = {
    type: "FEE",
    tradeDate: "2024-03-01",
    memo: "corrected fee",
    postings: [
      { accountId: "cash", amountMinor: "-2000" },
      { accountId: "world", amountMinor: "2000" },
    ],
  };

  it("without confirm returns a preview (old + replacement echo) and mutates nothing", async () => {
    const store = fakeJournalStore(new Map([["hh-a", [oldFee()]]]));
    const result = await invokeTool(supersedeJournalTool, ctxFor(store), {
      journalId: "j-fee-old",
      replacement: CORRECTED_FEE,
    });

    const out = ok(result);
    assertMoneyFieldsAreStrings(out);
    expect(out).toMatchObject({ preview: true, confirmationRequired: true });
    const current = out.current as Record<string, unknown>;
    const replacement = out.replacement as Record<string, unknown>;
    expect(current).toMatchObject({ id: "j-fee-old", status: "POSTED" });
    expect((replacement.postings as Array<Record<string, unknown>>)[0]).toMatchObject({
      amountMinor: "-2000",
    });
    // Nothing was written: no supersede, no insert, original still POSTED.
    expect(store.calls.filter((c) => c.method === "supersedePosted")).toHaveLength(0);
    expect(store.calls.filter((c) => c.method === "insertPosted")).toHaveLength(0);
    expect(store.store.get("hh-a")).toHaveLength(1);
    expect(store.store.get("hh-a")![0]!.status).toBe("POSTED");
  });

  it("with confirm marks the original SUPERSEDED and links the replacement; the original stays readable", async () => {
    const store = fakeJournalStore(new Map([["hh-a", [oldFee()]]]));
    const ctx = ctxFor(store);
    const result = await invokeTool(supersedeJournalTool, ctx, {
      journalId: "j-fee-old",
      replacement: CORRECTED_FEE,
      confirm: true,
    });

    const out = ok(result);
    assertMoneyFieldsAreStrings(out);
    expect(out.supersededJournalId).toBe("j-fee-old");
    expect(typeof out.replacementJournalId).toBe("string");

    const supersedes = store.calls.filter((c) => c.method === "supersedePosted");
    expect(supersedes).toHaveLength(1);
    const detail = supersedes[0]!.detail as { oldId: string; replacement: Journal };
    expect(detail.oldId).toBe("j-fee-old");
    expect(detail.replacement.postings[0]!.amount.minor).toBe(-2_000n);
    expect(detail.replacement.sortKey).toBe(1);

    // History is retained: the original is still there, marked SUPERSEDED,
    // and the replacement points back at it.
    const rows = store.store.get("hh-a")!;
    expect(rows).toHaveLength(2);
    expect(rows.find((j) => j.id === "j-fee-old")!.status).toBe("SUPERSEDED");
    const replacementRow = rows.find((j) => j.id === out.replacementJournalId)!;
    expect(replacementRow).toMatchObject({
      status: "POSTED",
      supersedesJournalId: "j-fee-old",
    });

    // …and it is still readable through get_journal, with the chain resolved.
    const readBack = await invokeTool(getJournalTool, ctx, { journalId: "j-fee-old" });
    expect(readBack.structuredContent).toMatchObject({
      journal: { id: "j-fee-old", status: "SUPERSEDED" },
      supersession: { supersededByJournalId: out.replacementJournalId },
    });
  });

  it("rejects superseding an already-superseded journal with NOT_POSTED and mutates nothing", async () => {
    const store = fakeJournalStore(new Map([["hh-a", [oldFee()]]]));
    const ctx = ctxFor(store);
    const first = await invokeTool(supersedeJournalTool, ctx, {
      journalId: "j-fee-old",
      replacement: CORRECTED_FEE,
      confirm: true,
    });
    expect(first.isError).toBeUndefined();

    const second = err(
      await invokeTool(supersedeJournalTool, ctx, {
        journalId: "j-fee-old",
        replacement: CORRECTED_FEE,
        confirm: true,
      }),
    );
    expect(second.code).toBe("NOT_POSTED");
    expect(store.calls.filter((c) => c.method === "supersedePosted")).toHaveLength(1);
    expect(store.store.get("hh-a")).toHaveLength(2);
  });

  it("rejects an unbalanced replacement and mutates nothing", async () => {
    const store = fakeJournalStore(new Map([["hh-a", [oldFee()]]]));
    const result = await invokeTool(supersedeJournalTool, ctxFor(store), {
      journalId: "j-fee-old",
      replacement: {
        ...CORRECTED_FEE,
        postings: [
          { accountId: "cash", amountMinor: "-2000" },
          { accountId: "world", amountMinor: "2001" },
        ],
      },
      confirm: true,
    });

    expect(err(result).code).toBe("UNBALANCED_JOURNAL");
    expect(store.calls.filter((c) => c.method === "supersedePosted")).toHaveLength(0);
    expect(store.store.get("hh-a")![0]!.status).toBe("POSTED");
  });

  it("rejects a journal id from another household with UNKNOWN_JOURNAL and mutates nothing", async () => {
    const store = fakeJournalStore(
      new Map([
        ["hh-a", [oldFee()]],
        ["hh-b", JOURNALS_B.map((j) => ({ ...j }))],
      ]),
    );
    const result = await invokeTool(supersedeJournalTool, ctxFor(store), {
      journalId: "jb1-deposit",
      replacement: CORRECTED_FEE,
      confirm: true,
    });

    expect(err(result).code).toBe("UNKNOWN_JOURNAL");
    expect(store.calls.filter((c) => c.method === "supersedePosted")).toHaveLength(0);
    expect(store.store.get("hh-b")![0]!.status).toBe("POSTED");
  });

  it("rejects a sortKey inside the replacement", async () => {
    const store = fakeJournalStore(new Map([["hh-a", [oldFee()]]]));
    const result = await invokeTool(supersedeJournalTool, ctxFor(store), {
      journalId: "j-fee-old",
      replacement: { ...CORRECTED_FEE, sortKey: 0 },
      confirm: true,
    });

    expect(err(result).code).toBe("INVALID_INPUT");
    expect(store.calls).toHaveLength(0);
  });
});

describe("scope and annotations", () => {
  it.each([
    ["record_journal", recordJournalTool, false],
    ["supersede_journal", supersedeJournalTool, true],
  ] as const)("%s requires read_write scope with destructiveHint=%s", (name, tool, destructive) => {
    expect(tool.name).toBe(name);
    expect(tool.scope).toBe("read_write");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.destructiveHint).toBe(destructive);
  });

  const scopeCases: Array<[string, AnyToolDefinition, unknown]> = [
    ["record_journal", recordJournalTool, BUY_INPUT],
    [
      "supersede_journal",
      supersedeJournalTool,
      {
        journalId: "j-deposit",
        replacement: {
          type: "DEPOSIT",
          tradeDate: "2024-01-05",
          postings: [
            { accountId: "world", amountMinor: "-500000" },
            { accountId: "cash", amountMinor: "500000" },
          ],
        },
        confirm: true,
      },
    ],
  ];
  it.each(scopeCases)("a read-scope token is denied %s before the handler runs", async (_name, tool, input) => {
    const store = fakeJournalStore(new Map([["hh-a", seedJournals()]]));
    const ctx = makeTestCtx({
      householdId: "hh-a",
      scope: "read",
      repos: { journals: store.read, journalWrites: store.write, accounts: accounts() },
    });
    const result = await invokeTool(tool, ctx, input);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    // The handler provably never ran: the fake saw no repo calls at all.
    expect(store.calls).toHaveLength(0);
    expect(store.store.get("hh-a")).toHaveLength(2);
  });
});
