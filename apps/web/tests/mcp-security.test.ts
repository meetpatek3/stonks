import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError, money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import {
  createAccountRepo,
  createJournalRepo,
  type AccountRecord,
  type Db,
  type JournalListFilters,
} from "@stonks/db";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { invokeTool, type AnyToolDefinition, type McpToolContext } from "@/lib/mcp/registrar";
import { createToolContext } from "@/lib/mcp/context";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";
import type { PortfolioSnapshot } from "@/lib/portfolio-shared";
import { assertMoneyFieldsAreStrings } from "./helpers/mcp-test-utils";

/**
 * Task 13 security suite (design spec §3, §6, §10, §11, §12). This is not a
 * coverage exercise: each test is written to FAIL if the guarantee it covers
 * were quietly missing, over a faithful in-memory two-household world. Every
 * fake enforces the same household filtering the production repos do
 * (`WHERE household_id = ? AND ...`); every repo call is logged with the
 * household id it carried, and every mutating call lands in a write log.
 *
 * Snapshots come from the REAL read model (`derivePortfolioSnapshot`) over
 * the in-memory journals below. Sentinels for household B (its net-worth
 * figure, account ids, journal ids, a private memo) are derived from the
 * fixtures, never hardcoded from output.
 */

const HH_A = "hh-a";
const HH_B = "hh-b";

/* ---------------------------------------------------------------------- */
/* Fixtures: two households with disjoint, sentinel-marked data.           */
/* ---------------------------------------------------------------------- */

const META_A: AccountMeta[] = [
  { id: "a-brokerage", name: "A Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "a-cash", name: "A Cash", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "a-world", name: "A World", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

const META_B: AccountMeta[] = [
  { id: "b-cash", name: "B Cash", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "b-invest", name: "B Invest", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "b-world", name: "B World", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

function seedJournalsA(): Journal[] {
  return [
    {
      id: "ja-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-01-02",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "a-cash", amount: money("CAD", 500_000n) },
        { accountId: "a-world", amount: money("CAD", -500_000n) },
      ],
    },
    {
      id: "ja-buy",
      type: "BUY",
      tradeDate: "2024-01-05",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "a-brokerage",
          amount: money("CAD", 250_000n),
          quantity: qtyFromDecimalString("100"),
          securityId: "XEQT",
          tradeCurrency: "CAD",
          tradeAmountMinor: 250_000n,
        },
        { accountId: "a-cash", amount: money("CAD", -250_000n) },
      ],
    },
    {
      id: "ja-fee",
      type: "FEE",
      tradeDate: "2024-02-01",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      memo: "wrong fee",
      externalNaturalKey: "a-stmt-row-1",
      postings: [
        { accountId: "a-cash", amount: money("CAD", -1_000n) },
        { accountId: "a-world", amount: money("CAD", 1_000n) },
      ],
    },
  ];
}

function seedJournalsB(): Journal[] {
  return [
    {
      id: "jb-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-01-02",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      memo: "B-PRIVATE-MEMO-XYZ",
      postings: [
        { accountId: "b-cash", amount: money("CAD", 700_000n) },
        { accountId: "b-world", amount: money("CAD", -700_000n) },
      ],
    },
    {
      id: "jb-opening",
      type: "OPENING",
      tradeDate: "2024-01-03",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "b-invest",
          amount: money("CAD", 100_000n),
          quantity: qtyFromDecimalString("40"),
          securityId: "BSECRET",
          tradeCurrency: "CAD",
          tradeAmountMinor: 100_000n,
        },
        { accountId: "b-world", amount: money("CAD", -100_000n) },
      ],
    },
  ];
}

const SNAPSHOT_A: PortfolioSnapshot = derivePortfolioSnapshot({
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  accounts: META_A,
  journals: seedJournalsA(),
});

const SNAPSHOT_B: PortfolioSnapshot = derivePortfolioSnapshot({
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  accounts: META_B,
  journals: seedJournalsB(),
});

/** Strings that exist only in household B's data. */
const B_SENTINELS = [
  "jb-deposit",
  "jb-opening",
  "b-cash",
  "b-invest",
  "b-world",
  "BSECRET",
  "B-PRIVATE-MEMO-XYZ",
  SNAPSHOT_B.netWorthMinor,
];

/** Strings that exist only in household A's data. */
const A_SENTINELS = [
  "ja-deposit",
  "ja-buy",
  "ja-fee",
  "a-brokerage",
  "a-cash",
  "a-world",
  "XEQT",
  SNAPSHOT_A.netWorthMinor,
];

/* ---------------------------------------------------------------------- */
/* The two-household world: faithful repos, call log, write log.           */
/* ---------------------------------------------------------------------- */

type RepoCall = { repo: string; method: string; householdId: string };

function buildWorld() {
  const accountStore = new Map<string, AccountRecord[]>([
    [
      HH_A,
      [
        ...META_A.map((m) => ({ ...m, taxTreatment: null, closedAt: null })),
        // A never-posted-to, zero-balance account for close_account probes.
        { id: "a-empty", name: "A Empty", type: "CASH", currency: "CAD", minorUnits: 2, taxTreatment: null, closedAt: null },
      ],
    ],
    [HH_B, META_B.map((m) => ({ ...m, taxTreatment: null, closedAt: null }))],
  ]);
  const journalStore = new Map<string, Journal[]>([
    [HH_A, seedJournalsA().map((j) => ({ ...j }))],
    [HH_B, seedJournalsB().map((j) => ({ ...j }))],
  ]);
  const snapshots = new Map<string, PortfolioSnapshot>([
    [HH_A, SNAPSHOT_A],
    [HH_B, SNAPSHOT_B],
  ]);
  const naturalKeys = new Map<string, string>();
  for (const [hh, rows] of journalStore) {
    for (const row of rows) {
      if (row.externalNaturalKey) naturalKeys.set(`${hh}|${row.externalNaturalKey}`, row.id);
    }
  }

  const calls: RepoCall[] = [];
  /** Mutating repo methods only — must stay empty for denied/preview paths. */
  const writes: RepoCall[] = [];

  const accounts = {
    list: async (householdId: string, options?: { includeClosed?: boolean }) => {
      calls.push({ repo: "accounts", method: "list", householdId });
      const rows = accountStore.get(householdId) ?? [];
      return options?.includeClosed ? rows : rows.filter((r) => r.closedAt === null);
    },
    getById: async (householdId: string, id: string) => {
      calls.push({ repo: "accounts", method: "getById", householdId });
      return (accountStore.get(householdId) ?? []).find((r) => r.id === id) ?? null;
    },
    getCurrency: async (code: string) =>
      code === "CAD" ? { code: "CAD", minorUnits: 2, name: "Canadian Dollar" } : null,
    create: async (householdId: string, input: { name: string; type: AccountRecord["type"]; currency: string; taxTreatment?: string | null }) => {
      writes.push({ repo: "accounts", method: "create", householdId });
      const record: AccountRecord = {
        id: `created-${input.name}`,
        name: input.name,
        type: input.type,
        currency: input.currency,
        minorUnits: 2,
        taxTreatment: input.taxTreatment ?? null,
        closedAt: null,
      };
      accountStore.get(householdId)!.push(record);
      return record;
    },
    close: async (householdId: string, id: string) => {
      writes.push({ repo: "accounts", method: "close", householdId });
      const record = (accountStore.get(householdId) ?? []).find((r) => r.id === id);
      if (!record) return null;
      if (record.closedAt === null) record.closedAt = "2024-06-01T00:00:00.000Z";
      return record;
    },
  };

  const journals = {
    listAll: async (householdId: string, filters: JournalListFilters = {}) => {
      calls.push({ repo: "journals", method: "listAll", householdId });
      let rows = (journalStore.get(householdId) ?? []).slice();
      if (!filters.includeSuperseded) rows = rows.filter((j) => j.status === "POSTED");
      if (filters.type) rows = rows.filter((j) => j.type === filters.type);
      if (filters.accountId) {
        rows = rows.filter((j) => j.postings.some((p) => p.accountId === filters.accountId));
      }
      return rows;
    },
    getById: async (householdId: string, id: string) => {
      calls.push({ repo: "journals", method: "getById", householdId });
      return (journalStore.get(householdId) ?? []).find((j) => j.id === id) ?? null;
    },
    findSupersedingId: async (householdId: string, journalId: string) => {
      calls.push({ repo: "journals", method: "findSupersedingId", householdId });
      return (
        (journalStore.get(householdId) ?? []).find((j) => j.supersedesJournalId === journalId)
          ?.id ?? null
      );
    },
  };

  const journalWrites = {
    insertPosted: async (journal: Journal, householdId: string) => {
      writes.push({ repo: "journalWrites", method: "insertPosted", householdId });
      journalStore.get(householdId)!.push(journal);
      if (journal.externalNaturalKey) {
        naturalKeys.set(`${householdId}|${journal.externalNaturalKey}`, journal.id);
      }
    },
    supersedePosted: async (householdId: string, oldId: string, replacement: Journal) => {
      writes.push({ repo: "journalWrites", method: "supersedePosted", householdId });
      const rows = journalStore.get(householdId) ?? [];
      const old = rows.find((j) => j.id === oldId);
      if (!old) {
        throw new ValidationError(`Unknown journal in this household: ${oldId}`, "UNKNOWN_JOURNAL", [oldId]);
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
    nextSortKey: async (householdId: string, tradeDate: string) => {
      calls.push({ repo: "journalWrites", method: "nextSortKey", householdId });
      const keys = (journalStore.get(householdId) ?? [])
        .filter((j) => j.tradeDate === tradeDate && j.status === "POSTED")
        .map((j) => j.sortKey);
      return keys.length === 0 ? 0 : Math.max(...keys) + 1;
    },
    findByNaturalKey: async (householdId: string, key: string) => {
      calls.push({ repo: "journalWrites", method: "findByNaturalKey", householdId });
      return naturalKeys.get(`${householdId}|${key}`) ?? null;
    },
  };

  const portfolio = {
    getSnapshot: async (householdId: string) => {
      calls.push({ repo: "portfolio", method: "getSnapshot", householdId });
      const snapshot = snapshots.get(householdId);
      if (!snapshot) throw new Error(`no snapshot for ${householdId}`);
      return snapshot;
    },
  };

  const interest = {
    getAttribution: async (householdId: string, periodStart: string, periodEnd: string) => {
      calls.push({ repo: "interest", method: "getAttribution", householdId });
      return {
        periodStart,
        periodEnd,
        reportingCurrency: "CAD",
        reportingMinorUnits: 2,
        investmentInterestMinor: "0",
        actualInterestJournalIds: [],
        allocations: [],
        unallocatedMinor: "0",
        uncertaintyReasons: [],
      };
    },
  };

  const prices = {
    getSecurity: async (securityId: string) =>
      securityId === "XEQT" || securityId === "BSECRET"
        ? { id: securityId, currency: "CAD", minorUnits: 2 }
        : null,
    listOverrides: async (householdId: string) => {
      calls.push({ repo: "prices", method: "listOverrides", householdId });
      return [];
    },
    latestQuoteAsOf: async (securityId: string, currency: string, asOf: string) =>
      securityId === "XEQT" || securityId === "BSECRET"
        ? {
            securityId,
            currency,
            asOf,
            priceMinor: 100n,
            source: "fixture",
            fetchedAt: "2024-01-05T00:00:00.000Z",
          }
        : null,
    insertOverride: async (householdId: string) => {
      writes.push({ repo: "prices", method: "insertOverride", householdId });
    },
  };

  const household = {
    getReportingCurrency: async (householdId: string) => {
      calls.push({ repo: "household", method: "getReportingCurrency", householdId });
      return "CAD";
    },
  };

  const ctx = (householdId: string, scope: "read" | "read_write"): McpToolContext => ({
    householdId,
    scope,
    repos: { household, portfolio, interest, prices, accounts, journals, journalWrites },
  });

  return { ctx, calls, writes, accountStore, journalStore };
}

type Result = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (result: Result) => {
  expect(result, JSON.stringify(result)).not.toMatchObject({ isError: true });
  return result.structuredContent as Record<string, unknown>;
};

const err = (result: Result) => {
  expect(result.isError, JSON.stringify(result)).toBe(true);
  return result.structuredContent as { code: string; message: string; hint?: string };
};

const tool = (name: string): AnyToolDefinition => {
  const def = MCP_TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def;
};

/** Every repo call the world saw must have carried exactly this household. */
function expectCallsScopedTo(calls: RepoCall[], householdId: string) {
  expect(
    new Set(calls.map((c) => c.householdId)),
    `repo calls escaped ${householdId}: ${JSON.stringify(calls)}`,
  ).toEqual(new Set([householdId]));
}

/* ---------------------------------------------------------------------- */
/* Guarantees 5–8: authentication.                                         */
/* ---------------------------------------------------------------------- */

describe("authentication", () => {
  function fakeTokenRepo() {
    const active = new Map<string, { householdId: string; scope: "read" | "read_write" }>([
      ["stk_read_a", { householdId: HH_A, scope: "read" }],
      ["stk_rw_a", { householdId: HH_A, scope: "read_write" }],
    ]);
    return {
      active,
      verify: vi.fn(async (plaintext: string) => active.get(plaintext) ?? null),
    };
  }

  it("rejects a request with no bearer token", async () => {
    const repo = fakeTokenRepo();
    expect(await authenticateMcpRequest(null, repo)).toBeNull();
    expect(repo.verify).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    const repo = fakeTokenRepo();
    expect(await authenticateMcpRequest("Bearer stk_forged", repo)).toBeNull();
  });

  it("rejects a revoked token on its next use", async () => {
    const repo = fakeTokenRepo();
    expect(await authenticateMcpRequest("Bearer stk_read_a", repo)).toEqual({
      householdId: HH_A,
      scope: "read",
    });
    // Revocation: the row is now marked revoked_at, so verify resolves null.
    repo.active.delete("stk_read_a");
    expect(await authenticateMcpRequest("Bearer stk_read_a", repo)).toBeNull();
  });

  it("rejects malformed Authorization headers without throwing and without a DB call", async () => {
    const repo = fakeTokenRepo();
    const malformed = [
      "",
      "   ",
      "Bearer",
      "Bearer ",
      "stk_read_a",
      "Basic stk_read_a",
      "Bearer stk_read_a extra",
      "BEARER",
      "Token stk_read_a",
      "Bearer\t",
    ];
    for (const header of malformed) {
      expect(await authenticateMcpRequest(header, repo), `header: ${JSON.stringify(header)}`).toBeNull();
    }
    // None of these may reach the token lookup — a malformed header is
    // rejected by parsing alone.
    expect(repo.verify).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------- */
/* Guarantees 1, 3, 4: tenant isolation on reads.                          */
/* ---------------------------------------------------------------------- */

describe("tenant isolation — reads", () => {
  const readCases: Array<[string, unknown]> = [
    ["ping", {}],
    ["get_portfolio_overview", {}],
    ["list_accounts", {}],
    ["list_accounts", { includeClosed: true }],
    ["list_positions", {}],
    ["list_positions", { accountId: "a-brokerage" }],
    ["list_open_items", {}],
    ["list_open_items", { severity: "WARNING" }],
    ["list_journals", {}],
    ["list_journals", { includeSuperseded: true }],
    ["list_journals", { accountId: "a-cash" }],
    ["get_journal", { journalId: "ja-fee" }],
    ["get_borrowing_summary", {}],
    ["get_interest_attribution", { from: "2024-01-01", to: "2024-01-02" }],
    ["get_tax_year_summary", { year: 2024 }],
    ["get_price", { securityId: "XEQT", currency: "CAD", asOf: "2024-01-05" }],
  ];

  it.each(readCases)("%s %j returns only household A's data to A's token", async (name, input) => {
    const world = buildWorld();
    const result = await invokeTool(tool(name), world.ctx(HH_A, "read"), input);

    const payload = ok(result);
    assertMoneyFieldsAreStrings(payload);
    const wire = JSON.stringify(result);
    for (const sentinel of B_SENTINELS) {
      expect(wire, `${name} leaked B sentinel ${sentinel}`).not.toContain(sentinel);
    }
    expectCallsScopedTo(world.calls, HH_A);
    expect(world.writes).toEqual([]);
  });

  it.each(readCases)("%s %j returns only household B's data to B's token", async (name, inputRaw) => {
    // Mirror the inputs onto B's own ids where the input names one of A's.
    const input = JSON.parse(
      JSON.stringify(inputRaw)
        .replaceAll("a-brokerage", "b-invest")
        .replaceAll("a-cash", "b-cash")
        .replaceAll("ja-fee", "jb-deposit")
        .replaceAll("XEQT", "BSECRET"),
    ) as unknown;
    const world = buildWorld();
    const result = await invokeTool(tool(name), world.ctx(HH_B, "read"), input);

    const wire = JSON.stringify(ok(result));
    for (const sentinel of A_SENTINELS) {
      expect(wire, `${name} leaked A sentinel ${sentinel}`).not.toContain(sentinel);
    }
    expectCallsScopedTo(world.calls, HH_B);
    expect(world.writes).toEqual([]);
  });

  const idProbes: Array<[string, (id: string) => unknown, string]> = [
    ["get_journal", (id) => ({ journalId: id }), "UNKNOWN_JOURNAL"],
    ["list_journals", (id) => ({ accountId: id }), "UNKNOWN_ACCOUNT"],
    ["list_positions", (id) => ({ accountId: id }), "UNKNOWN_ACCOUNT"],
    ["supersede_journal", (id) => ({
      journalId: id,
      replacement: {
        type: "FEE",
        tradeDate: "2024-02-01",
        postings: [
          { accountId: "a-cash", amountMinor: "-1000" },
          { accountId: "a-world", amountMinor: "1000" },
        ],
      },
      confirm: true,
    }), "UNKNOWN_JOURNAL"],
    ["close_account", (id) => ({ accountId: id, confirm: true }), "UNKNOWN_ACCOUNT"],
  ];

  it.each(idProbes)(
    "%s with household B's real id is a not-found error for A — never B's data, never a mutation",
    async (name, inputFor, code) => {
      const world = buildWorld();
      const bId = name === "get_journal" || name === "supersede_journal" ? "jb-deposit" : "b-cash";
      const before = world.journalStore.get(HH_B)!.length;
      const bAccountOpen = world.accountStore.get(HH_B)!.find((a) => a.id === "b-cash")!.closedAt;

      const result = await invokeTool(tool(name), world.ctx(HH_A, "read_write"), inputFor(bId));

      const failure = err(result);
      expect(failure.code).toBe(code);
      // B's journal amount/memo must not ride along in the error.
      const wire = JSON.stringify(result);
      expect(wire).not.toContain("B-PRIVATE-MEMO-XYZ");
      expect(wire).not.toContain("BSECRET");
      expect(world.writes).toEqual([]);
      expect(world.journalStore.get(HH_B)).toHaveLength(before);
      expect(world.accountStore.get(HH_B)!.find((a) => a.id === "b-cash")!.closedAt).toBe(bAccountOpen);
    },
  );

  it.each(idProbes)(
    "%s does not disclose whether an id exists in another household",
    async (name, inputFor) => {
      const world = buildWorld();
      const bId = name === "get_journal" || name === "supersede_journal" ? "jb-deposit" : "b-cash";
      const missingId = "definitely-not-a-real-id";

      const foreign = err(await invokeTool(tool(name), world.ctx(HH_A, "read_write"), inputFor(bId)));
      const unknown = err(
        await invokeTool(tool(name), world.ctx(HH_A, "read_write"), inputFor(missingId)),
      );

      // Identical modulo the caller-supplied id itself: an oracle here would
      // let an agent enumerate which ids exist in other households.
      expect(foreign.code).toBe(unknown.code);
      expect(foreign.message.replaceAll(bId, "<id>")).toBe(
        unknown.message.replaceAll(missingId, "<id>"),
      );
      expect((foreign.hint ?? "").replaceAll(bId, "<id>")).toBe(
        (unknown.hint ?? "").replaceAll(missingId, "<id>"),
      );
    },
  );
});

/* ---------------------------------------------------------------------- */
/* Guarantee 2: tenant isolation on writes.                                */
/* ---------------------------------------------------------------------- */

describe("tenant isolation — writes", () => {
  it("record_journal cannot post into household B's account", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      type: "WITHDRAWAL",
      tradeDate: "2024-03-01",
      postings: [
        { accountId: "a-world", amountMinor: "-50000" },
        { accountId: "b-cash", amountMinor: "50000" },
      ],
    });

    expect(err(result).code).toBe("UNKNOWN_ACCOUNT");
    expect(world.writes).toEqual([]);
    expect(world.journalStore.get(HH_A)).toHaveLength(3);
    expect(world.journalStore.get(HH_B)).toHaveLength(2);
  });

  it("record_journal cannot post into household B even when every posting names B's accounts", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      postings: [
        { accountId: "b-world", amountMinor: "-50000" },
        { accountId: "b-cash", amountMinor: "50000" },
      ],
    });

    expect(err(result).code).toBe("UNKNOWN_ACCOUNT");
    expect(world.writes).toEqual([]);
    expect(world.journalStore.get(HH_B)).toHaveLength(2);
  });

  it("supersede_journal cannot touch household B's journal", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("supersede_journal"), world.ctx(HH_A, "read_write"), {
      journalId: "jb-deposit",
      replacement: {
        type: "DEPOSIT",
        tradeDate: "2024-01-02",
        postings: [
          { accountId: "a-cash", amountMinor: "1" },
          { accountId: "a-world", amountMinor: "-1" },
        ],
      },
      confirm: true,
    });

    expect(err(result).code).toBe("UNKNOWN_JOURNAL");
    expect(world.writes).toEqual([]);
    expect(world.journalStore.get(HH_B)!.find((j) => j.id === "jb-deposit")!.status).toBe("POSTED");
  });

  it("close_account cannot close household B's account", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("close_account"), world.ctx(HH_A, "read_write"), {
      accountId: "b-cash",
      confirm: true,
    });

    expect(err(result).code).toBe("UNKNOWN_ACCOUNT");
    expect(world.writes).toEqual([]);
    expect(world.accountStore.get(HH_B)!.find((a) => a.id === "b-cash")!.closedAt).toBeNull();
  });

  it("create_account lands in the token's household only", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("create_account"), world.ctx(HH_A, "read_write"), {
      name: "a-new",
      type: "CASH",
      currency: "CAD",
    });

    ok(result);
    expect(world.writes).toEqual([{ repo: "accounts", method: "create", householdId: HH_A }]);
    expect(world.accountStore.get(HH_A)!.some((a) => a.id === "created-a-new")).toBe(true);
    expect(world.accountStore.get(HH_B)!.some((a) => a.id === "created-a-new")).toBe(false);
  });

  it("identity fields smuggled in tool input are never honoured", async () => {
    const world = buildWorld();
    // Zod strips unknown keys; the handler must draw identity from ctx only.
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      householdId: HH_B,
      scope: "read_write",
      postings: [
        { accountId: "a-world", amountMinor: "-100" },
        { accountId: "a-cash", amountMinor: "100" },
      ],
    });

    ok(result);
    // The journal was written to A's household — never to B's.
    expect(world.writes).toEqual([
      { repo: "journalWrites", method: "insertPosted", householdId: HH_A },
    ]);
    expect(world.journalStore.get(HH_B)).toHaveLength(2);

    const world2 = buildWorld();
    const readResult = await invokeTool(tool("list_journals"), world2.ctx(HH_A, "read"), {
      householdId: HH_B,
      scope: "read_write",
    });
    const wire = JSON.stringify(ok(readResult));
    for (const sentinel of B_SENTINELS) {
      expect(wire).not.toContain(sentinel);
    }
    expectCallsScopedTo(world2.calls, HH_A);
  });
});

/* ---------------------------------------------------------------------- */
/* Guarantees 9–10: scope enforcement by the registrar.                    */
/* ---------------------------------------------------------------------- */

describe("scope enforcement", () => {
  const writeTools = MCP_TOOLS.filter((t) => t.scope === "read_write");
  const readTools = MCP_TOOLS.filter((t) => t.scope === "read");

  it("the registry actually contains read_write tools to deny (guard against a vacuous loop)", () => {
    expect(writeTools.map((t) => t.name).sort()).toEqual([
      "close_account",
      "create_account",
      "record_journal",
      "set_price_override",
      "supersede_journal",
    ]);
    expect(readTools.length).toBeGreaterThan(0);
  });

  it.each(writeTools.map((t) => [t.name, t] as const))(
    "a read-scope token calling %s is SCOPE_DENIED by the registrar, handler never invoked",
    async (_name, def) => {
      const world = buildWorld();
      const handler = vi.fn(def.handler as AnyToolDefinition["handler"]);
      const spied: AnyToolDefinition = { ...def, handler };
      const validInputByTool: Record<string, unknown> = {
        record_journal: {
          type: "DEPOSIT",
          tradeDate: "2024-03-01",
          postings: [
            { accountId: "a-world", amountMinor: "-1" },
            { accountId: "a-cash", amountMinor: "1" },
          ],
        },
        supersede_journal: {
          journalId: "ja-fee",
          replacement: {
            type: "DEPOSIT",
            tradeDate: "2024-03-01",
            postings: [
              { accountId: "a-world", amountMinor: "-1" },
              { accountId: "a-cash", amountMinor: "1" },
            ],
          },
          confirm: true,
        },
        create_account: { name: "x", type: "CASH", currency: "CAD" },
        close_account: { accountId: "a-empty", confirm: true },
        set_price_override: {
          securityId: "XEQT",
          asOf: "2024-03-01",
          priceMinor: "100",
          currency: "CAD",
          note: "scope probe",
        },
      };
      const input = validInputByTool[def.name];
      expect(input, `missing valid scope probe for ${def.name}`).toBeDefined();

      // Even a fully valid payload must not matter: scope is checked before
      // parsing and before the handler.
      const result = await invokeTool(spied, world.ctx(HH_A, "read"), input);

      expect(handler).not.toHaveBeenCalled();
      expect(world.calls).toEqual([]);
      expect(world.writes).toEqual([]);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    },
  );

  it("every tool's annotations are consistent with its declared scope", () => {
    for (const def of MCP_TOOLS) {
      expect(def.annotations, def.name).toBeDefined();
      if (def.scope === "read") {
        expect(def.annotations.readOnlyHint, def.name).toBe(true);
        expect(def.annotations.destructiveHint, def.name).toBe(false);
      } else {
        expect(def.annotations.readOnlyHint, def.name).toBe(false);
      }
    }
    // The confirm-gated tools are exactly the destructive-hinted ones.
    const destructive = MCP_TOOLS.filter((t) => t.annotations.destructiveHint === true).map(
      (t) => t.name,
    );
    expect(destructive.sort()).toEqual(["close_account", "supersede_journal"]);
  });

  it("scope cannot be escalated through tool input", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read"), {
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      scope: "read_write",
      tokenScope: "read_write",
      postings: [
        { accountId: "a-world", amountMinor: "-100" },
        { accountId: "a-cash", amountMinor: "100" },
      ],
    });

    expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    expect(world.writes).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- */
/* Guarantees 11–16: write safety.                                         */
/* ---------------------------------------------------------------------- */

const VALID_DEPOSIT = {
  type: "DEPOSIT",
  tradeDate: "2024-03-01",
  postings: [
    { accountId: "a-world", amountMinor: "-50000" },
    { accountId: "a-cash", amountMinor: "50000" },
  ],
};

describe("write safety", () => {
  it("an unbalanced journal writes nothing at all — no partial rows", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      externalNaturalKey: "unbalanced-attempt",
      postings: [
        { accountId: "a-world", amountMinor: "-50000" },
        { accountId: "a-cash", amountMinor: "49999" },
      ],
    });

    expect(world.writes).toEqual([]);
    // No trace persists: not the journal, not a natural-key tombstone.
    expect(world.journalStore.get(HH_A)).toHaveLength(3);
    expect(err(result).code).toBe("UNBALANCED_JOURNAL");
    const readBack = await invokeTool(tool("list_journals"), world.ctx(HH_A, "read"), {
      includeSuperseded: true,
    });
    const journals = ok(readBack).journals as Array<{ tradeDate: string }>;
    expect(journals.filter((j) => j.tradeDate === "2024-03-01")).toHaveLength(0);
  });

  it("an unbalanced supersession replacement writes nothing", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("supersede_journal"), world.ctx(HH_A, "read_write"), {
      journalId: "ja-fee",
      replacement: {
        type: "FEE",
        tradeDate: "2024-02-01",
        postings: [
          { accountId: "a-cash", amountMinor: "-2000" },
          { accountId: "a-world", amountMinor: "2001" },
        ],
      },
      confirm: true,
    });

    expect(world.writes).toEqual([]);
    expect(world.journalStore.get(HH_A)!.find((j) => j.id === "ja-fee")!.status).toBe("POSTED");
    expect(world.journalStore.get(HH_A)).toHaveLength(3);
    expect(err(result).code).toBe("UNBALANCED_JOURNAL");
  });

  it("a client-supplied sortKey is never honoured — rejected at the schema boundary", async () => {
    const world = buildWorld();
    const topLevel = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      ...VALID_DEPOSIT,
      sortKey: 0,
    });
    expect(err(topLevel).code).toBe("INVALID_INPUT");
    expect(JSON.stringify(topLevel)).toContain("sortKey");

    const nested = await invokeTool(tool("supersede_journal"), world.ctx(HH_A, "read_write"), {
      journalId: "ja-fee",
      replacement: { ...VALID_DEPOSIT, sortKey: 0 },
      confirm: true,
    });
    expect(err(nested).code).toBe("INVALID_INPUT");
    expect(world.writes).toEqual([]);

    // And a legitimate call gets a SERVER-assigned key: 2024-01-05 already has
    // a POSTED journal at sortKey 0, so the next one is 1 — regardless of
    // anything the client asked for.
    const recorded = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      type: "DEPOSIT",
      tradeDate: "2024-01-05",
      postings: [
        { accountId: "a-world", amountMinor: "-100" },
        { accountId: "a-cash", amountMinor: "100" },
      ],
    });
    const out = ok(recorded);
    expect((out.journal as { sortKey: number }).sortKey).toBe(1);
  });

  it.each([undefined, false])(
    "supersede_journal with confirm=%s mutates nothing and returns a preview",
    async (confirm) => {
      const world = buildWorld();
      const result = await invokeTool(tool("supersede_journal"), world.ctx(HH_A, "read_write"), {
        journalId: "ja-fee",
        replacement: {
          type: "FEE",
          tradeDate: "2024-02-01",
          postings: [
            { accountId: "a-cash", amountMinor: "-2000" },
            { accountId: "a-world", amountMinor: "2000" },
          ],
        },
        ...(confirm === undefined ? {} : { confirm }),
      });

      const out = ok(result);
      expect(out).toMatchObject({ preview: true, confirmationRequired: true });
      expect(world.writes).toEqual([]);
      expect(world.journalStore.get(HH_A)).toHaveLength(3);
      expect(world.journalStore.get(HH_A)!.find((j) => j.id === "ja-fee")!.status).toBe("POSTED");
    },
  );

  it.each([undefined, false])(
    "close_account with confirm=%s mutates nothing and returns a preview",
    async (confirm) => {
      const world = buildWorld();
      const result = await invokeTool(tool("close_account"), world.ctx(HH_A, "read_write"), {
        accountId: "a-empty",
        ...(confirm === undefined ? {} : { confirm }),
      });

      const out = ok(result);
      expect(out).toMatchObject({ preview: true, confirmationRequired: true });
      expect(world.writes).toEqual([]);
      expect(world.accountStore.get(HH_A)!.find((a) => a.id === "a-empty")!.closedAt).toBeNull();
    },
  );

  it("supersession retains history — the original stays readable afterwards", async () => {
    const world = buildWorld();
    const ctx = world.ctx(HH_A, "read_write");
    const result = await invokeTool(tool("supersede_journal"), ctx, {
      journalId: "ja-fee",
      replacement: {
        type: "FEE",
        tradeDate: "2024-02-01",
        postings: [
          { accountId: "a-cash", amountMinor: "-2000" },
          { accountId: "a-world", amountMinor: "2000" },
        ],
      },
      confirm: true,
    });

    const out = ok(result);
    expect(out.preview).toBe(false);
    expect(world.journalStore.get(HH_A)).toHaveLength(4);

    // The original is still there, marked, with the chain resolved both ways.
    const original = await invokeTool(tool("get_journal"), ctx, { journalId: "ja-fee" });
    expect(ok(original)).toMatchObject({
      journal: { id: "ja-fee", status: "SUPERSEDED" },
      supersession: { supersededByJournalId: out.replacementJournalId },
    });
    const replacement = await invokeTool(tool("get_journal"), ctx, {
      journalId: out.replacementJournalId as string,
    });
    expect(ok(replacement)).toMatchObject({
      journal: { status: "POSTED", supersedesJournalId: "ja-fee" },
    });

    // Default history hides the superseded row; the audit view shows it marked.
    const defaultList = await invokeTool(tool("list_journals"), ctx, {});
    expect(
      (ok(defaultList).journals as Array<{ id: string }>).map((j) => j.id),
    ).not.toContain("ja-fee");
    const auditList = await invokeTool(tool("list_journals"), ctx, { includeSuperseded: true });
    const auditRows = ok(auditList).journals as Array<{ id: string; status: string }>;
    expect(auditRows.find((j) => j.id === "ja-fee")?.status).toBe("SUPERSEDED");
  });

  it("a duplicate externalNaturalKey does not double-post", async () => {
    const world = buildWorld();
    const result = await invokeTool(tool("record_journal"), world.ctx(HH_A, "read_write"), {
      ...VALID_DEPOSIT,
      externalNaturalKey: "a-stmt-row-1", // already recorded as ja-fee
    });

    const out = ok(result);
    expect(out).toMatchObject({ duplicate: true, journalId: "ja-fee" });
    expect(world.writes).toEqual([]);
    expect(world.journalStore.get(HH_A)).toHaveLength(3);
    expect(
      world.journalStore.get(HH_A)!.filter((j) => j.externalNaturalKey === "a-stmt-row-1"),
    ).toHaveLength(1);
  });

  it("no MCP tool or repo method can edit or delete a journal or posting", () => {
    // Runtime enumeration — a future method added to a repo or a future tool
    // added to the registry cannot silently reintroduce mutation of history.
    const journalRepo = createJournalRepo({} as unknown as Db);
    const accountRepo = createAccountRepo({} as unknown as Db);
    const FORBIDDEN = /delete|remove|purge|edit|update|truncate|overwrite/i;
    for (const key of Object.keys(journalRepo)) {
      expect(key, `journal repo method "${key}"`).not.toMatch(FORBIDDEN);
    }
    for (const key of Object.keys(accountRepo)) {
      expect(key, `account repo method "${key}"`).not.toMatch(FORBIDDEN);
    }
    for (const def of MCP_TOOLS) {
      expect(def.name).not.toMatch(FORBIDDEN);
    }

    // And no tool implementation reaches for a delete/update path directly.
    const toolsDir = resolve(import.meta.dirname, "../lib/mcp/tools");
    for (const file of readdirSync(toolsDir)) {
      const source = readFileSync(resolve(toolsDir, file), "utf8");
      expect(source, file).not.toMatch(/\.delete\s*\(|\.update\s*\(/);
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Guarantees 17–18: privilege boundaries and leak-freedom.                */
/* ---------------------------------------------------------------------- */

describe("privilege boundaries", () => {
  it("no registered MCP tool can create, list, or revoke a token, or touch auth credentials", () => {
    // Derived from the actual registry: a future tool named like credential
    // management fails here immediately.
    const CREDENTIAL_SURFACE = /token|password|credential|secret|revoke|session|api[-_]?key/i;
    for (const def of MCP_TOOLS) {
      expect(def.name, `tool "${def.name}" must not be on the credential surface`).not.toMatch(
        CREDENTIAL_SURFACE,
      );
    }

    // The production context wires no credential-capable repo into handlers.
    const ctx = createToolContext({} as unknown as Db, { householdId: HH_A, scope: "read" });
    for (const key of Object.keys(ctx.repos)) {
      expect(key).not.toMatch(CREDENTIAL_SURFACE);
    }
  });

  it("no MCP module imports the token store or the session/auth code", () => {
    const mcpDir = resolve(import.meta.dirname, "../lib/mcp");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(mcpDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /createTokenRepo|token-repo|lib\/tokens|auth\/session|apiToken|api_token/,
      );
    }
  });

  it("read-tool responses contain no token hash, password hash, or secret-looking field", async () => {
    const world = buildWorld();
    const readCases: Array<[string, unknown]> = [
      ["ping", {}],
      ["get_portfolio_overview", {}],
      ["list_accounts", { includeClosed: true }],
      ["list_positions", {}],
      ["list_open_items", {}],
      ["list_journals", { includeSuperseded: true }],
      ["get_journal", { journalId: "ja-fee" }],
      ["get_borrowing_summary", {}],
      ["get_interest_attribution", { from: "2024-01-01", to: "2024-01-02" }],
      ["get_tax_year_summary", { year: 2024 }],
      ["get_price", { securityId: "XEQT", currency: "CAD", asOf: "2024-01-05" }],
    ];
    const SHA256_HEX = /\b[0-9a-f]{64}\b/i;
    const BCRYPT = /\$2[aby]\$/;
    const SECRET_KEY = /hash|password|secret|token/i;

    const offendingKeys = (payload: unknown, path: string, out: string[]) => {
      if (Array.isArray(payload)) {
        payload.forEach((v, i) => offendingKeys(v, `${path}[${i}]`, out));
      } else if (typeof payload === "object" && payload !== null) {
        for (const [k, v] of Object.entries(payload)) {
          if (SECRET_KEY.test(k)) out.push(`${path}.${k}`);
          offendingKeys(v, `${path}.${k}`, out);
        }
      }
    };

    for (const [name, input] of readCases) {
      const result = await invokeTool(tool(name), world.ctx(HH_A, "read"), input);
      const wire = JSON.stringify(ok(result));
      expect(wire, name).not.toMatch(SHA256_HEX);
      expect(wire, name).not.toMatch(BCRYPT);
      const bad: string[] = [];
      offendingKeys(result, name, bad);
      expect(bad).toEqual([]);
    }
  });

  it("an unexpected failure leaks no stack trace, SQL, or internals", async () => {
    // Keep the (deliberate) correlation-id server log out of the suite output.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const exploding: AnyToolDefinition = {
        ...tool("record_journal"),
        inputSchema: {},
        handler: async () => {
          throw new Error(
            "duplicate key value violates unique constraint \"api_token_token_hash_key\"\n" +
              "    at PostgresConnection.query (node_modules/postgres/src/connection.js:42:11)",
          );
        },
      };
      const world = buildWorld();
      const result = await invokeTool(exploding, world.ctx(HH_A, "read_write"), {});

      const failure = err(result);
      expect(failure.code).toBe("INTERNAL");
      const wire = JSON.stringify(result);
      expect(wire).not.toContain("api_token");
      expect(wire).not.toContain("duplicate key");
      expect(wire).not.toContain("node_modules");
      expect(wire).not.toMatch(/\bat\s+\w+.*\.js:\d+/); // no stack frames
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Guarantee 19: money typing at the protocol boundary.                    */
/* ---------------------------------------------------------------------- */

describe("money typing at the protocol boundary", () => {
  type Leaf = { tool: string; path: string; zodType: string };

  // Only count-like / integer-bps fields may ever be JSON numbers (spec §4).
  const NUMBER_NAME_ALLOWLIST = /^(limit|rateBps|spreadBps|bps|year|page|count)$/;

  function walk(toolName: string, path: string, schema: unknown, out: Leaf[]): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let s = schema as any;
    while (["optional", "nullable", "default"].includes(s?._zod?.def?.type)) {
      s = s._zod.def.innerType;
    }
    const zodType: string = s?._zod?.def?.type ?? "unknown";
    if (zodType === "object") {
      for (const [key, value] of Object.entries(s.shape as Record<string, unknown>)) {
        walk(toolName, path ? `${path}.${key}` : key, value, out);
      }
    } else if (zodType === "array") {
      walk(toolName, `${path}[]`, s.element, out);
    } else {
      out.push({ tool: toolName, path, zodType });
    }
  }

  it("every registered tool schema types money, quantity, and FX fields as strings — never JSON numbers", () => {
    const leaves: Leaf[] = [];
    for (const def of MCP_TOOLS) {
      for (const [key, schema] of Object.entries(def.inputSchema as Record<string, unknown>)) {
        walk(def.name, key, schema, leaves);
      }
    }
    expect(leaves.length).toBeGreaterThan(0);

    const MONEY_NAME = /minor|quantity|fxrate|amount|price|cost|balance/i;
    const violations: string[] = [];
    const numbersFound: string[] = [];
    for (const leaf of leaves) {
      const name = leaf.path.split(".").pop()!.replace(/\[\]$/, "");
      if (leaf.zodType === "number") {
        numbersFound.push(`${leaf.tool}:${leaf.path}`);
        if (!NUMBER_NAME_ALLOWLIST.test(name)) {
          violations.push(`${leaf.tool}:${leaf.path} is z.number()`);
        }
      }
      if (MONEY_NAME.test(name) && leaf.zodType !== "string" && leaf.zodType !== "never") {
        violations.push(`${leaf.tool}:${leaf.path} types a money field as ${leaf.zodType}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
    // Legible inventory of every number-typed input on the surface today.
    expect(numbersFound).toEqual(["list_journals:limit", "get_tax_year_summary:year"]);
  });

  it.each([
    ["amountMinor", { amountMinor: 50000 }],
    ["quantity", { quantity: 100 }],
    ["tradeAmountMinor", { tradeAmountMinor: 250000 }],
    ["fxRateN", { fxRateN: 135 }],
  ])(
    "record_journal rejects a JSON number for %s and the handler never runs",
    async (_field, postingExtra) => {
      const world = buildWorld();
      const def = tool("record_journal");
      const handler = vi.fn(def.handler as AnyToolDefinition["handler"]);
      const result = await invokeTool({ ...def, handler }, world.ctx(HH_A, "read_write"), {
        type: "BUY",
        tradeDate: "2024-03-01",
        postings: [
          {
            accountId: "a-brokerage",
            amountMinor: "250000",
            ...postingExtra,
          },
          { accountId: "a-cash", amountMinor: "-250000" },
        ],
      });

      const failure = err(result);
      expect(failure.code).toBe("INVALID_INPUT");
      expect(failure.message).toContain("postings.0.");
      expect(failure.message).toContain("string");
      expect(handler).not.toHaveBeenCalled();
      expect(world.writes).toEqual([]);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});
