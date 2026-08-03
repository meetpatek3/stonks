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
      accounts: {
        list: async () => [],
        getById: async () => null,
      },
      journals: {
        listAll: async () => [],
        getById: async () => null,
        findSupersedingId: async () => null,
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
