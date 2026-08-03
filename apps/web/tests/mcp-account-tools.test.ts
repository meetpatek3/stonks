import { describe, expect, it } from "vitest";
import type { AccountRecord } from "@stonks/db";
import { invokeTool, type AnyToolDefinition } from "@/lib/mcp/registrar";
import { closeAccountTool, createAccountTool } from "@/lib/mcp/tools/accounts";
import { emptyPortfolioSnapshot } from "@/lib/portfolio-shared";
import { assertMoneyFieldsAreStrings, makeTestCtx } from "./helpers/mcp-test-utils";

/**
 * Task 8 account tools: create_account and close_account (spec §8 tools
 * 15–16). The account repo fake is an in-memory two-household store with a
 * write log; balances come from a hand-built snapshot, matching how the
 * production tool reads them from the replay-derived read model — never a
 * stored figure.
 */

const CURRENCIES = [
  { code: "CAD", minorUnits: 2, name: "Canadian Dollar" },
  { code: "USD", minorUnits: 2, name: "US Dollar" },
];

function fakeAccountStore(seed: Map<string, AccountRecord[]>) {
  const store = new Map<string, AccountRecord[]>(
    [...seed.entries()].map(([hh, rows]) => [hh, rows.map((row) => ({ ...row }))]),
  );
  const calls: Array<{ method: string; householdId: string; detail?: unknown }> = [];

  return {
    store,
    calls,
    repo: {
      list: async (householdId: string, options?: { includeClosed?: boolean }) => {
        const rows = store.get(householdId) ?? [];
        return options?.includeClosed ? rows : rows.filter((row) => row.closedAt === null);
      },
      getById: async (householdId: string, id: string) =>
        (store.get(householdId) ?? []).find((row) => row.id === id) ?? null,
      getCurrency: async (code: string) => CURRENCIES.find((c) => c.code === code) ?? null,
      create: async (
        householdId: string,
        input: { name: string; type: AccountRecord["type"]; currency: string; taxTreatment?: string | null },
      ) => {
        calls.push({ method: "create", householdId, detail: input });
        const currency = CURRENCIES.find((c) => c.code === input.currency);
        if (!currency) throw new Error(`currency should have been validated: ${input.currency}`);
        const record: AccountRecord = {
          id: `acct-new-${store.get(householdId)!.length + 1}`,
          name: input.name,
          type: input.type,
          currency: input.currency,
          minorUnits: currency.minorUnits,
          taxTreatment: input.taxTreatment ?? null,
          closedAt: null,
        };
        store.get(householdId)!.push(record);
        return record;
      },
      close: async (householdId: string, id: string) => {
        calls.push({ method: "close", householdId, detail: id });
        const record = (store.get(householdId) ?? []).find((row) => row.id === id);
        if (!record) return null;
        if (record.closedAt === null) record.closedAt = "2026-08-03T15:00:00.000Z";
        return record;
      },
    },
  };
}

const seedAccounts = () =>
  new Map<string, AccountRecord[]>([
    [
      "hh-a",
      [
        { id: "cash", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
        { id: "old", name: "Old TFSA", type: "INVESTMENT", currency: "CAD", minorUnits: 2, taxTreatment: "TFSA", closedAt: null },
      ],
    ],
    [
      "hh-b",
      [
        { id: "acct-b-cash", name: "B cash", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
      ],
    ],
  ]);

/** Snapshot with a 1,500.00 CAD replay balance on account "cash" (hh-a). */
function snapshotWithBalances(balances: Array<{ accountId: string; accountName: string; accountType: "CASH" | "INVESTMENT"; currency: string; minor: string }>) {
  return {
    getSnapshot: async (householdId: string) => ({
      ...emptyPortfolioSnapshot({ householdId, reportingCurrency: "CAD" }),
      balances: balances.map((row) => ({ ...row, minorUnits: 2 })),
    }),
  };
}

const ctxFor = (
  store: ReturnType<typeof fakeAccountStore>,
  balances: Parameters<typeof snapshotWithBalances>[0] = [],
  householdId = "hh-a",
  scope: "read" | "read_write" = "read_write",
) =>
  makeTestCtx({
    householdId,
    scope,
    repos: { accounts: store.repo, portfolio: snapshotWithBalances(balances) },
  });

const err = (result: { isError?: boolean; structuredContent?: Record<string, unknown> }) => {
  expect(result.isError).toBe(true);
  return result.structuredContent as { code: string; message: string; hint?: string };
};

describe("create_account", () => {
  it("creates an account in the token's household and returns it", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(createAccountTool, ctxFor(store), {
      name: "USD Brokerage",
      type: "INVESTMENT",
      currency: "USD",
      taxTreatment: "TFSA",
    });

    expect(result.isError).toBeUndefined();
    assertMoneyFieldsAreStrings(result.structuredContent);
    const out = result.structuredContent as { account: AccountRecord };
    expect(out.account).toMatchObject({
      name: "USD Brokerage",
      type: "INVESTMENT",
      currency: "USD",
      minorUnits: 2,
      taxTreatment: "TFSA",
      closedAt: null,
    });
    const creates = store.calls.filter((c) => c.method === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      householdId: "hh-a",
      detail: { name: "USD Brokerage", type: "INVESTMENT", currency: "USD", taxTreatment: "TFSA" },
    });
    expect(store.store.get("hh-a")).toHaveLength(3);
    expect(store.store.get("hh-b")).toHaveLength(1);
  });

  it("rejects an invalid account type at the schema boundary", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(createAccountTool, ctxFor(store), {
      name: "Savings",
      type: "SAVINGS",
      currency: "CAD",
    });

    const out = err(result);
    expect(out.code).toBe("INVALID_INPUT");
    expect(out.message).toContain("type");
    expect(store.calls).toHaveLength(0);
  });

  it("rejects an unknown currency and writes nothing", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(createAccountTool, ctxFor(store), {
      name: "Euro cash",
      type: "CASH",
      currency: "EUR",
    });

    const out = err(result);
    expect(out.code).toBe("VALIDATION");
    expect(out.message).toContain("EUR");
    expect(store.calls.filter((c) => c.method === "create")).toHaveLength(0);
  });
});

describe("close_account", () => {
  it("without confirm returns a preview and mutates nothing", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(closeAccountTool, ctxFor(store), { accountId: "old" });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as Record<string, unknown>;
    assertMoneyFieldsAreStrings(out);
    expect(out).toMatchObject({ preview: true, confirmationRequired: true });
    expect(out.account).toMatchObject({ id: "old", closedAt: null });
    expect(store.calls.filter((c) => c.method === "close")).toHaveLength(0);
    expect(store.store.get("hh-a")!.find((a) => a.id === "old")!.closedAt).toBeNull();
  });

  it("with confirm and a zero replay balance closes the account", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(closeAccountTool, ctxFor(store), {
      accountId: "old",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as { account: AccountRecord };
    expect(out.account.id).toBe("old");
    expect(out.account.closedAt).toBe("2026-08-03T15:00:00.000Z");
    const closes = store.calls.filter((c) => c.method === "close");
    expect(closes).toEqual([{ method: "close", householdId: "hh-a", detail: "old" }]);
  });

  it("refuses a non-zero replay balance with ACCOUNT_NOT_EMPTY, naming the balance", async () => {
    const store = fakeAccountStore(seedAccounts());
    const balances = [
      { accountId: "cash", accountName: "Chequing", accountType: "CASH" as const, currency: "CAD", minor: "150000" },
    ];

    // Refused with and without confirm — the balance check precedes the gate.
    for (const input of [{ accountId: "cash" }, { accountId: "cash", confirm: true }]) {
      const result = await invokeTool(closeAccountTool, ctxFor(store, balances), input);
      const out = err(result);
      expect(out.code).toBe("ACCOUNT_NOT_EMPTY");
      expect(out.message).toContain("150000");
    }
    expect(store.calls.filter((c) => c.method === "close")).toHaveLength(0);
    expect(store.store.get("hh-a")!.find((a) => a.id === "cash")!.closedAt).toBeNull();
  });

  it("treats an account with no replay rows as a real zero balance", async () => {
    const store = fakeAccountStore(seedAccounts());
    const balances = [
      { accountId: "cash", accountName: "Chequing", accountType: "CASH" as const, currency: "CAD", minor: "150000" },
    ];
    const result = await invokeTool(closeAccountTool, ctxFor(store, balances), {
      accountId: "old",
      confirm: true,
    });
    expect(result.isError).toBeUndefined();
  });

  it("rejects another household's account id with UNKNOWN_ACCOUNT and mutates nothing", async () => {
    const store = fakeAccountStore(seedAccounts());
    const result = await invokeTool(closeAccountTool, ctxFor(store), {
      accountId: "acct-b-cash",
      confirm: true,
    });

    expect(err(result).code).toBe("UNKNOWN_ACCOUNT");
    expect(store.calls.filter((c) => c.method === "close")).toHaveLength(0);
    expect(store.store.get("hh-b")![0]!.closedAt).toBeNull();
  });
});

describe("scope and annotations", () => {
  it.each([
    ["create_account", createAccountTool, false],
    ["close_account", closeAccountTool, true],
  ] as const)("%s requires read_write scope with destructiveHint=%s", (name, tool, destructive) => {
    expect(tool.name).toBe(name);
    expect(tool.scope).toBe("read_write");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.destructiveHint).toBe(destructive);
  });

  const scopeCases: Array<[string, AnyToolDefinition, unknown]> = [
    ["create_account", createAccountTool, { name: "X", type: "CASH", currency: "CAD" }],
    ["close_account", closeAccountTool, { accountId: "old", confirm: true }],
  ];
  it.each(scopeCases)("a read-scope token is denied %s before the handler runs", async (_name, tool, input) => {
    const store = fakeAccountStore(seedAccounts());
    const ctx = ctxFor(store, [], "hh-a", "read");
    const result = await invokeTool(tool, ctx, input);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    expect(store.calls).toHaveLength(0);
    expect(store.store.get("hh-a")).toHaveLength(2);
  });
});
