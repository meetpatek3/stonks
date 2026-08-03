import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import type { AccountRecord } from "@stonks/db";
import { invokeTool } from "@/lib/mcp/registrar";
import {
  getPortfolioOverviewTool,
  listAccountsTool,
  listOpenItemsTool,
  listPositionsTool,
} from "@/lib/mcp/tools/portfolio";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";
import type { PortfolioSnapshot } from "@/lib/portfolio-shared";
import { assertMoneyFieldsAreStrings, makeTestCtx } from "./helpers/mcp-test-utils";

/**
 * Task 5 read tools: get_portfolio_overview, list_accounts, list_positions,
 * list_open_items.
 *
 * Snapshots come from the REAL read model (`derivePortfolioSnapshot`) over
 * the in-memory journals below; every expected figure is hand-calculated
 * from those journals, never captured from output.
 */

const ACCOUNT_META: AccountMeta[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

const openingUnknownAapl: Journal = {
  id: "j-open-aapl",
  type: "OPENING",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 0n),
      quantity: qtyFromDecimalString("10"),
      securityId: "AAPL",
      tradeCurrency: "CAD",
      tradeAmountMinor: 0n,
    },
    { accountId: "world", amount: money("CAD", 0n) },
  ],
};

const deposit: Journal = {
  id: "j-deposit",
  type: "DEPOSIT",
  tradeDate: "2024-01-02",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 500_000n) },
    { accountId: "world", amount: money("CAD", -500_000n) },
  ],
};

/** Buy 100 XEQT for 2,500.00 CAD out of chequing. */
const buyOne: Journal = {
  id: "j-buy-1",
  type: "BUY",
  tradeDate: "2024-01-05",
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
    { accountId: "chequing", amount: money("CAD", -250_000n) },
  ],
};

/** Buy 50 XEQT for 1,500.00 CAD drawn on the credit facility (INVESTMENT use). */
const buyTwoOnFacility: Journal = {
  id: "j-buy-2",
  type: "BUY",
  tradeDate: "2024-02-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 150_000n),
      quantity: qtyFromDecimalString("50"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: 150_000n,
    },
    { accountId: "facility", amount: money("CAD", -150_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 150_000n) }],
};

/**
 * Sell 30 of 150 XEQT for 1,200.00 CAD.
 * ACB of the lot sold: allocateCost(400_000, 30, 150) = 80_000.
 * Realized gain: 120_000 − 80_000 = 40_000. Remaining: 120 units, cost 320_000.
 */
const sellPartial: Journal = {
  id: "j-sell-1",
  type: "SELL",
  tradeDate: "2024-03-05",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", -120_000n),
      quantity: qtyFromDecimalString("-30"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: -120_000n,
    },
    { accountId: "chequing", amount: money("CAD", 120_000n) },
  ],
};

const JOURNALS_A = [openingUnknownAapl, deposit, buyOne, buyTwoOnFacility, sellPartial];

const SNAPSHOT_A: PortfolioSnapshot = derivePortfolioSnapshot({
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  accounts: ACCOUNT_META,
  journals: JOURNALS_A,
});

/** Household B: a single 7,000.00 CAD deposit, so net worth is 700_000. */
const SNAPSHOT_B: PortfolioSnapshot = derivePortfolioSnapshot({
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  accounts: [
    { id: "acct-b-1", name: "B chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
    { id: "world-b", name: "B world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
  ],
  journals: [
    {
      id: "j-b-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-01-02",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "acct-b-1", amount: money("CAD", 700_000n) },
        { accountId: "world-b", amount: money("CAD", -700_000n) },
      ],
    },
  ],
});

const ACCOUNTS_A: AccountRecord[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2, taxTreatment: "TFSA", closedAt: null },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
  // Closed and never posted to: excluded by default, replay balance a real zero.
  { id: "old-brokerage", name: "Old brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2, taxTreatment: "RRSP", closedAt: "2024-06-01T00:00:00.000Z" },
];

const ACCOUNTS_B: AccountRecord[] = [
  { id: "acct-b-1", name: "B chequing", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
];

function fakeSnapshots(byHousehold: Map<string, PortfolioSnapshot>) {
  const calls: string[] = [];
  return {
    calls,
    getSnapshot: async (householdId: string) => {
      calls.push(householdId);
      const snapshot = byHousehold.get(householdId);
      if (!snapshot) throw new Error(`no snapshot for ${householdId}`);
      return snapshot;
    },
  };
}

function fakeAccounts(byHousehold: Map<string, AccountRecord[]>) {
  const calls: { householdId: string; includeClosed?: boolean | undefined }[] = [];
  return {
    calls,
    list: async (householdId: string, options?: { includeClosed?: boolean }) => {
      calls.push({ householdId, includeClosed: options?.includeClosed });
      const rows = byHousehold.get(householdId) ?? [];
      return options?.includeClosed ? rows : rows.filter((row) => row.closedAt === null);
    },
    getById: async (householdId: string, id: string) =>
      (byHousehold.get(householdId) ?? []).find((row) => row.id === id) ?? null,
  };
}

const snapshots = () => fakeSnapshots(new Map([["hh-a", SNAPSHOT_A], ["hh-b", SNAPSHOT_B]]));
const accounts = () => fakeAccounts(new Map([["hh-a", ACCOUNTS_A], ["hh-b", ACCOUNTS_B]]));

describe("get_portfolio_overview", () => {
  it("returns hand-calculated totals with every money field a minor-unit string", async () => {
    const snaps = snapshots();
    const ctx = makeTestCtx({ householdId: "hh-a", repos: { portfolio: snaps } });
    const result = await invokeTool(getPortfolioOverviewTool, ctx, {});

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent! as Record<string, unknown>;
    assertMoneyFieldsAreStrings(out);

    // Hand-calculated from JOURNALS_A:
    //   brokerage 250_000 + 150_000 − 120_000 = 280_000
    //   chequing 500_000 − 250_000 + 120_000 = 370_000
    //   facility −150_000 → borrowed 150_000
    //   net worth 280_000 + 370_000 − 150_000 = 500_000
    expect(out.netWorthMinor).toBe("500000");
    expect(out.totalInvestedMinor).toBe("280000");
    expect(out.totalBorrowedMinor).toBe("150000");
    expect(out.reportingCurrency).toBe("CAD");
    expect(out.totalsAreUncertain).toBe(false);

    const byType = out.balancesByType as Record<string, Array<{ accountId: string; minor: string }>>;
    expect(byType.INVESTMENT).toEqual([
      expect.objectContaining({ accountId: "brokerage", minor: "280000" }),
    ]);
    expect(byType.CREDIT_FACILITY).toEqual([
      expect.objectContaining({ accountId: "facility", minor: "-150000" }),
    ]);

    expect(out.openItemCounts).toMatchObject({ total: 1, unknownCost: 1 });
    expect(out.allocationBasis).toBe("COST");

    const allocation = out.allocation as Array<{ securityId: string; bps: number }>;
    expect(allocation.map((row) => row.securityId)).toEqual(["XEQT"]);
    expect(allocation.reduce((sum, row) => sum + row.bps, 0)).toBe(10000);
    expect(out.allocationIsIncomplete).toBe(true); // AAPL cost unknown → omitted

    const series = out.valueOverTime as Array<{ month: string; valueMinor: string }>;
    expect(series.map((point) => point.month)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(series.every((point) => point.valueMinor === "500000")).toBe(true);
  });

  it("is scoped to the token's household: B's token gets B's snapshot, never A's", async () => {
    const snaps = snapshots();
    const ctx = makeTestCtx({ householdId: "hh-b", repos: { portfolio: snaps } });
    const result = await invokeTool(getPortfolioOverviewTool, ctx, {});

    expect(result.structuredContent).toMatchObject({ netWorthMinor: "700000" });
    expect(snaps.calls).toEqual(["hh-b"]);
  });
});

describe("list_accounts", () => {
  it("joins account metadata to replay balances, excluding closed accounts by default", async () => {
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { portfolio: snapshots(), accounts: accounts() },
    });
    const result = await invokeTool(listAccountsTool, ctx, {});

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent! as { accounts: Array<Record<string, unknown>> };
    assertMoneyFieldsAreStrings(out);

    const byId = new Map(out.accounts.map((row) => [row.id, row]));
    expect([...byId.keys()].sort()).toEqual(["brokerage", "chequing", "facility", "world"]);
    expect(byId.get("brokerage")).toMatchObject({
      type: "INVESTMENT",
      currency: "CAD",
      taxTreatment: "TFSA",
      balanceMinor: "280000",
      closedAt: null,
    });
    expect(byId.get("chequing")).toMatchObject({ balanceMinor: "370000" });
    expect(byId.get("facility")).toMatchObject({ balanceMinor: "-150000" });
    expect(byId.get("world")).toMatchObject({ balanceMinor: "-500000" });
  });

  it("includes closed accounts with their closedAt when asked; a never-posted account replays to a real zero", async () => {
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { portfolio: snapshots(), accounts: accounts() },
    });
    const result = await invokeTool(listAccountsTool, ctx, { includeClosed: true });

    const out = result.structuredContent! as { accounts: Array<Record<string, unknown>> };
    const closed = out.accounts.find((row) => row.id === "old-brokerage");
    expect(closed).toMatchObject({
      closedAt: "2024-06-01T00:00:00.000Z",
      taxTreatment: "RRSP",
      balanceMinor: "0", // no postings → replay balance is exactly zero, a fact
    });
  });

  it("passes the token's household id to the repo, so A never lists B's accounts", async () => {
    const accts = accounts();
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { portfolio: snapshots(), accounts: accts },
    });
    const result = await invokeTool(listAccountsTool, ctx, { includeClosed: true });

    expect(accts.calls).toEqual([{ householdId: "hh-a", includeClosed: true }]);
    const out = result.structuredContent! as { accounts: Array<{ id: string }> };
    expect(out.accounts.some((row) => row.id === "acct-b-1")).toBe(false);
  });
});

describe("list_positions", () => {
  it("returns position rows with cost, realized gains and borrow cost as strings", async () => {
    const ctx = makeTestCtx({ householdId: "hh-a", repos: { portfolio: snapshots() } });
    const result = await invokeTool(listPositionsTool, ctx, {});

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent! as { positions: Array<Record<string, unknown>> };
    assertMoneyFieldsAreStrings(out);
    expect(out.positions.map((row) => row.key)).toEqual(["brokerage:AAPL", "brokerage:XEQT"]);

    const xeqt = out.positions[1]!;
    expect(xeqt).toMatchObject({
      accountId: "brokerage",
      securityId: "XEQT",
      quantity: "120.00000000",
      tradeCurrency: "CAD",
      costReportingMinor: "320000",
      costIsUnknown: false,
      realizedGainReportingMinor: "40000",
      realizedGainUncertaintyReason: null,
      realizedSourceJournalIds: ["j-sell-1"],
      interestCostMinor: "0", // facility drawn but no interest charged yet — a real zero
    });
  });

  it("keeps an unknown cost basis visibly unknown: null cost and gain, never 0", async () => {
    const ctx = makeTestCtx({ householdId: "hh-a", repos: { portfolio: snapshots() } });
    const result = await invokeTool(listPositionsTool, ctx, {});

    const out = result.structuredContent! as { positions: Array<Record<string, unknown>> };
    const aapl = out.positions[0]!;
    expect(aapl).toMatchObject({
      securityId: "AAPL",
      costIsUnknown: true,
      costReportingMinor: null,
      unrealizedGainMinor: null,
      grossReturnBps: null,
      netReturnBps: null,
    });
    expect(aapl.costReportingMinor).not.toBe("0");
    const reasons = aapl.valuationUncertaintyReasons as string[];
    expect(reasons.some((reason) => reason.includes("No cost basis is recorded for AAPL"))).toBe(true);
  });

  it("filters by accountId after verifying the account belongs to the household", async () => {
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { portfolio: snapshots(), accounts: accounts() },
    });
    const result = await invokeTool(listPositionsTool, ctx, { accountId: "brokerage" });
    const out = result.structuredContent! as { positions: Array<{ accountId: string }> };
    expect(out.positions.every((row) => row.accountId === "brokerage")).toBe(true);
  });

  it("rejects another household's account id with UNKNOWN_ACCOUNT — never with B's data", async () => {
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { portfolio: snapshots(), accounts: accounts() },
    });
    const result = await invokeTool(listPositionsTool, ctx, { accountId: "acct-b-1" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "UNKNOWN_ACCOUNT" });
    expect(JSON.stringify(result)).toContain("acct-b-1");
  });
});

describe("list_open_items", () => {
  it("carries kind, severity, message and trace ids from the snapshot", async () => {
    const ctx = makeTestCtx({ householdId: "hh-a", repos: { portfolio: snapshots() } });
    const result = await invokeTool(listOpenItemsTool, ctx, {});

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent! as {
      openItems: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };
    assertMoneyFieldsAreStrings(out);
    expect(out.openItems).toEqual([
      expect.objectContaining({
        kind: "UNKNOWN_COST_BASIS",
        severity: "WARNING",
        refType: "POSITION",
        refId: "brokerage:AAPL",
      }),
    ]);
    expect(out.openItems[0]!.message).toContain("AAPL");
    expect(out.counts).toMatchObject({ total: 1 });
  });

  it("filters by severity", async () => {
    const ctx = makeTestCtx({ householdId: "hh-a", repos: { portfolio: snapshots() } });
    const warning = await invokeTool(listOpenItemsTool, ctx, { severity: "WARNING" });
    expect((warning.structuredContent! as { openItems: unknown[] }).openItems).toHaveLength(1);

    const error = await invokeTool(listOpenItemsTool, ctx, { severity: "ERROR" });
    expect((error.structuredContent! as { openItems: unknown[] }).openItems).toHaveLength(0);
  });
});

describe("annotations and scope", () => {
  it.each([
    ["get_portfolio_overview", getPortfolioOverviewTool],
    ["list_accounts", listAccountsTool],
    ["list_positions", listPositionsTool],
    ["list_open_items", listOpenItemsTool],
  ])("%s is a read-scoped, read-only tool", (name, tool) => {
    expect(tool.name).toBe(name);
    expect(tool.scope).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });
});
