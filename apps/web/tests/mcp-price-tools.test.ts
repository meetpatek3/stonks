import { describe, expect, it } from "vitest";
import type { PriceOverride, PriceQuote } from "@stonks/ledger";
import { getPriceTool, setPriceOverrideTool } from "@/lib/mcp/tools/prices";
import { invokeTool } from "@/lib/mcp/registrar";
import { makeTestCtx, assertMoneyFieldsAreStrings } from "./helpers/mcp-test-utils";

const SECURITY = {
  id: "sec-aapl",
  currency: "USD",
  minorUnits: 2,
};

const STALE_QUOTE: PriceQuote = {
  securityId: SECURITY.id,
  currency: SECURITY.currency,
  asOf: "2024-01-02",
  priceMinor: 12_345n,
  source: "fixture",
  fetchedAt: "2024-01-02T21:00:00.000Z",
};

function priceRepo(options: {
  security?: typeof SECURITY | null;
  overrides?: PriceOverride[];
  quote?: PriceQuote | null;
} = {}) {
  const inserted: Array<{ householdId: string; override: PriceOverride & { createdBy: string } }> = [];
  return {
    inserted,
    repo: {
      getSecurity: async (securityId: string) =>
        securityId === SECURITY.id ? options.security ?? SECURITY : null,
      listOverrides: async (_householdId: string) => options.overrides ?? [],
      latestQuoteAsOf: async () => options.quote ?? null,
      insertOverride: async (
        householdId: string,
        override: PriceOverride & { createdBy: string },
      ) => {
        inserted.push({ householdId, override });
      },
    },
  };
}

describe("get_price", () => {
  it("returns a stale provider quote as a real figure with QUOTE provenance", async () => {
    const prices = priceRepo({ quote: STALE_QUOTE });
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: { prices: prices.repo },
    });

    const result = await invokeTool(getPriceTool, ctx, {
      securityId: SECURITY.id,
      currency: "USD",
      asOf: "2024-01-03",
    });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as Record<string, unknown>;
    assertMoneyFieldsAreStrings(out);
    expect(out).toMatchObject({
      securityId: "sec-aapl",
      priceMinor: "12345",
      currency: "USD",
      minorUnits: 2,
      source: "QUOTE",
      asOf: "2024-01-02",
      requestedAsOf: "2024-01-03",
      stale: true,
    });
    expect(out.priceMinor).not.toBeNull();
  });

  it("prefers a same-day household override and labels it OVERRIDE", async () => {
    const prices = priceRepo({
      quote: STALE_QUOTE,
      overrides: [
        {
          securityId: SECURITY.id,
          asOf: "2024-01-03",
          priceMinor: 13_000n,
          note: "manual mark",
        },
      ],
    });
    const result = await invokeTool(
      getPriceTool,
      makeTestCtx({ householdId: "hh-a", repos: { prices: prices.repo } }),
      { securityId: SECURITY.id, currency: "USD", asOf: "2024-01-03" },
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      priceMinor: "13000",
      source: "OVERRIDE",
      asOf: "2024-01-03",
      stale: false,
    });
  });

  it("returns PRICE_NOT_FOUND for an unknown security instead of throwing", async () => {
    const prices = priceRepo();
    const result = await invokeTool(
      getPriceTool,
      makeTestCtx({ repos: { prices: prices.repo } }),
      { securityId: "does-not-exist", currency: "USD", asOf: "2024-01-03" },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "PRICE_NOT_FOUND" });
  });
});

describe("set_price_override", () => {
  it("appends a minor-string manual override and never updates an existing row", async () => {
    const prices = priceRepo();
    const result = await invokeTool(
      setPriceOverrideTool,
      makeTestCtx({
        householdId: "hh-a",
        scope: "read_write",
        repos: { prices: prices.repo },
      }),
      {
        securityId: SECURITY.id,
        asOf: "2024-01-03",
        priceMinor: "13000",
        currency: "USD",
        note: "manual mark",
      },
    );

    expect(result.isError).toBeUndefined();
    assertMoneyFieldsAreStrings(result.structuredContent);
    expect(prices.inserted).toEqual([
      {
        householdId: "hh-a",
        override: {
          securityId: SECURITY.id,
          asOf: "2024-01-03",
          priceMinor: 13_000n,
          note: "manual mark",
          createdBy: "mcp",
        },
      },
    ]);
  });

  it("cannot be called by a read-scope token before the handler or repo runs", async () => {
    const prices = priceRepo();
    const result = await invokeTool(
      setPriceOverrideTool,
      makeTestCtx({ scope: "read", repos: { prices: prices.repo } }),
      {
        securityId: SECURITY.id,
        asOf: "2024-01-03",
        priceMinor: "13000",
        currency: "USD",
        note: "manual mark",
      },
    );

    expect(result.structuredContent).toMatchObject({ code: "SCOPE_DENIED" });
    expect(prices.inserted).toEqual([]);
  });

  it("rejects a JSON number for priceMinor at the schema boundary", async () => {
    const prices = priceRepo();
    const result = await invokeTool(
      setPriceOverrideTool,
      makeTestCtx({ scope: "read_write", repos: { prices: prices.repo } }),
      {
        securityId: SECURITY.id,
        asOf: "2024-01-03",
        priceMinor: 13_000,
        currency: "USD",
        note: "manual mark",
      },
    );

    expect(result.structuredContent).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(result)).toContain("priceMinor");
    expect(prices.inserted).toEqual([]);
  });
});
