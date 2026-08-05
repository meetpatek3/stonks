import { expect } from "vitest";
import type { McpRepos, McpToolContext } from "@/lib/mcp/registrar";
import { emptyPortfolioSnapshot } from "@/lib/portfolio-shared";

/**
 * Shared test scaffolding for MCP tool tests: a context factory whose fakes
 * are in-memory and DB-less, and the recursive money-typing assertion every
 * tool payload must survive.
 */

export function makeTestCtx(overrides?: {
  householdId?: string;
  scope?: "read" | "read_write";
  repos?: Partial<McpRepos>;
}): McpToolContext {
  const householdId = overrides?.householdId ?? "hh-a";
  return {
    householdId,
    scope: overrides?.scope ?? "read",
    repos: {
      household: { getReportingCurrency: async () => "CAD" },
      portfolio: {
        getSnapshot: async (id) =>
          emptyPortfolioSnapshot({ householdId: id, reportingCurrency: "CAD" }),
      },
      interest: {
        getAttribution: async (_householdId, periodStart, periodEnd) => ({
          periodStart,
          periodEnd,
          reportingCurrency: "CAD",
          reportingMinorUnits: 2,
          investmentInterestMinor: "0",
          actualInterestJournalIds: [],
          allocations: [],
          unallocatedMinor: "0",
          uncertaintyReasons: [],
        }),
      },
      prices: {
        getSecurity: async () => null,
        listOverrides: async () => [],
        latestQuoteAsOf: async () => null,
        insertOverride: async () => {
          throw new Error("prices.insertOverride not stubbed in this test");
        },
      },
      accounts: {
        list: async () => [],
        getById: async () => null,
        getCurrency: async () => null,
        create: async () => {
          throw new Error("accounts.create not stubbed in this test");
        },
        close: async () => null,
      },
      journals: {
        listAll: async () => [],
        getById: async () => null,
        findSupersedingId: async () => null,
      },
      journalWrites: {
        insertPosted: async () => {
          throw new Error("journalWrites.insertPosted not stubbed in this test");
        },
        supersedePosted: async () => {
          throw new Error("journalWrites.supersedePosted not stubbed in this test");
        },
        nextSortKey: async () => 0,
        findByNaturalKey: async () => null,
      },
      ...overrides?.repos,
    },
  };
}

/**
 * Money and quantity fields are the ones whose wire names end in `Minor`,
 * `quantity`, or `fxRateN`/`fxRateD`. Everything matching must be a string
 * (or null, where the contract allows an underivable figure) — a JSON number
 * on any of these is an IEEE-754 correctness bug. bps, counts, `minorUnits`,
 * and `sortKey` are deliberately not matched: those are legitimate numbers.
 */
const MONEY_KEY = /minor$|quantity$|fxrate[nd]$/i;

export function assertMoneyFieldsAreStrings(payload: unknown, path = "payload"): void {
  if (Array.isArray(payload)) {
    payload.forEach((value, index) => assertMoneyFieldsAreStrings(value, `${path}[${index}]`));
    return;
  }
  if (typeof payload !== "object" || payload === null) {
    return;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (MONEY_KEY.test(key) && value !== null) {
      expect(
        typeof value,
        `${path}.${key} must be a minor-unit / decimal string, got ${typeof value}`,
      ).toBe("string");
    }
    assertMoneyFieldsAreStrings(value, `${path}.${key}`);
  }
}
