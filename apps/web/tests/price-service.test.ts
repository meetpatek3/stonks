import { describe, expect, it } from "vitest";
import { FixtureMarketDataProvider, type PriceOverride, type PriceQuote } from "@stonks/ledger";
import { createQuoteFetcher, fixtureQuoteFetcher, type QuoteFetcher } from "@/lib/market/provider";
import { createPriceService, type SecurityRef } from "@/lib/market/price-service";

const NOW = "2026-08-01T20:00:00.000Z";

const quote = (over: Partial<PriceQuote> = {}): PriceQuote => ({
  securityId: "sec-aapl",
  currency: "USD",
  asOf: "2026-08-01",
  priceMinor: 10000n,
  source: "twelvedata",
  fetchedAt: NOW,
  ...over,
});

const security = (over: Partial<SecurityRef> = {}): SecurityRef => ({
  id: "sec-aapl",
  currency: "USD",
  minorUnits: 2,
  symbol: "AAPL",
  exchange: "NASDAQ",
  ...over,
});

/** In-memory stand-in for `createPriceRepo`, recording what the service persists. */
function fakeRepo(opts: {
  overrides?: readonly PriceOverride[];
  quotes?: readonly PriceQuote[];
} = {}) {
  const stored: PriceQuote[] = [...(opts.quotes ?? [])];
  const upsertBatches: PriceQuote[][] = [];
  return {
    upsertBatches,
    stored,
    repo: {
      async listOverrides() {
        return [...(opts.overrides ?? [])];
      },
      async insertOverride() {
        throw new Error("not used by the price service");
      },
      async upsertQuotes(quotes: readonly PriceQuote[]) {
        upsertBatches.push([...quotes]);
        const key = (q: PriceQuote) => `${q.securityId}|${q.currency}|${q.asOf}`;
        for (const q of quotes) {
          const at = stored.findIndex((s) => key(s) === key(q));
          if (at >= 0) stored[at] = q;
          else stored.push(q);
        }
      },
      async latestQuoteAsOf(securityId: string, currency: string, asOf: string) {
        const matches = stored.filter(
          (q) => q.securityId === securityId && q.currency === currency && q.asOf <= asOf,
        );
        if (matches.length === 0) return null;
        return matches.reduce((best, q) => (q.asOf > best.asOf ? q : best));
      },
    },
  };
}

/** Fetcher double: returns canned quotes, recording the requests it received. */
function fakeFetcher(quotes: readonly PriceQuote[] = []): QuoteFetcher & {
  batches: unknown[][];
} {
  const batches: unknown[][] = [];
  return {
    name: "fake",
    batches,
    async fetchQuotes(requests) {
      batches.push([...requests]);
      return quotes;
    },
  };
}

describe("createPriceService", () => {
  it("returns a quote for the requested date as source QUOTE, not stale", async () => {
    const { repo } = fakeRepo();
    const fetcher = fakeFetcher([quote()]);
    const service = createPriceService({ repo, fetcher });

    const results = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(results).toEqual([
      {
        securityId: "sec-aapl",
        source: "QUOTE",
        priceMinor: 10000n,
        currency: "USD",
        minorUnits: 2,
        asOf: "2026-08-01",
        requestedAsOf: "2026-08-01",
        stale: false,
      },
    ]);
  });

  it("persists fetched quotes through the repo", async () => {
    const { repo, stored } = fakeRepo();
    const service = createPriceService({ repo, fetcher: fakeFetcher([quote()]) });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.priceMinor).toBe(10000n);
  });

  it("returns an older quote with its real asOf and stale: true, never a substituted date", async () => {
    const { repo } = fakeRepo({ quotes: [quote({ asOf: "2026-07-29", priceMinor: 9900n })] });
    const service = createPriceService({ repo, fetcher: fakeFetcher([]) });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result).toMatchObject({
      source: "QUOTE",
      asOf: "2026-07-29",
      requestedAsOf: "2026-08-01",
      priceMinor: 9900n,
      stale: true,
    });
  });

  it("reports NONE with a null price when nothing is available", async () => {
    const { repo } = fakeRepo();
    const service = createPriceService({ repo, fetcher: fakeFetcher([]) });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result).toEqual({
      securityId: "sec-aapl",
      source: "NONE",
      priceMinor: null,
      currency: "USD",
      minorUnits: 2,
      asOf: null,
      requestedAsOf: "2026-08-01",
      stale: false,
    });
  });

  it("lets a manual override win over a same-day quote", async () => {
    const { repo } = fakeRepo({
      quotes: [quote()],
      overrides: [
        { securityId: "sec-aapl", asOf: "2026-08-01", priceMinor: 12345n, note: "manual mark" },
      ],
    });
    const service = createPriceService({ repo, fetcher: fakeFetcher([]) });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result).toMatchObject({
      source: "OVERRIDE",
      priceMinor: 12345n,
      asOf: "2026-08-01",
      // An override carries no currency of its own: it is denominated in the
      // security's currency, which is the only currency this service resolves in.
      currency: "USD",
      stale: false,
    });
  });

  it("does not call the provider for a security that already has an override for the date", async () => {
    const { repo } = fakeRepo({
      overrides: [
        { securityId: "sec-aapl", asOf: "2026-08-01", priceMinor: 12345n, note: "manual" },
      ],
    });
    const fetcher = fakeFetcher([]);
    const service = createPriceService({ repo, fetcher });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(fetcher.batches.flat()).toHaveLength(0);
  });

  it("does not re-fetch a security whose quote for the date is already persisted", async () => {
    const { repo } = fakeRepo({ quotes: [quote()] });
    const fetcher = fakeFetcher([]);
    const service = createPriceService({ repo, fetcher });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(fetcher.batches.flat()).toHaveLength(0);
  });

  it("still fetches when only an older quote is persisted", async () => {
    const { repo } = fakeRepo({ quotes: [quote({ asOf: "2026-07-29" })] });
    const fetcher = fakeFetcher([]);
    const service = createPriceService({ repo, fetcher });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(fetcher.batches.flat()).toHaveLength(1);
  });

  it("issues the pre-fetch cache lookups together, not one round trip after another", async () => {
    const { repo } = fakeRepo();
    let inFlight = 0;
    let peak = 0;
    const slowRepo = {
      ...repo,
      async latestQuoteAsOf(securityId: string, currency: string, asOf: string) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return repo.latestQuoteAsOf(securityId, currency, asOf);
      },
    };
    // Snapshot at fetch time, so this measures the pre-fetch phase only — the
    // per-security lookups inside resolvePrice run later and are already parallel.
    let peakBeforeFetch = 0;
    const service = createPriceService({
      repo: slowRepo,
      fetcher: {
        name: "peak-recording",
        async fetchQuotes() {
          peakBeforeFetch = peak;
          return [];
        },
      },
    });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [
        security(),
        security({ id: "sec-msft", symbol: "MSFT" }),
        security({ id: "sec-xiu", symbol: "XIU" }),
      ],
      asOf: "2026-08-01",
    });

    // Serialized lookups would never overlap: peak concurrency would be 1.
    expect(peakBeforeFetch).toBe(3);
  });

  it("deduplicates by (securityId, currency, asOf) before persisting, last write winning", async () => {
    const { repo, upsertBatches } = fakeRepo();
    const fetcher = fakeFetcher([
      quote({ priceMinor: 100n }),
      quote({ priceMinor: 200n }),
      quote({ securityId: "sec-msft", priceMinor: 300n }),
    ]);
    const service = createPriceService({ repo, fetcher });

    await service.resolvePrices({
      householdId: "hh-1",
      securities: [security(), security({ id: "sec-msft", symbol: "MSFT" })],
      asOf: "2026-08-01",
    });

    expect(upsertBatches).toHaveLength(1);
    expect(upsertBatches[0]).toHaveLength(2);
    expect(upsertBatches[0]?.[0]?.priceMinor).toBe(200n);
  });

  it("never throws when the provider fails, falling back to what is persisted", async () => {
    const { repo } = fakeRepo({ quotes: [quote({ asOf: "2026-07-29", priceMinor: 5n })] });
    const exploding: QuoteFetcher = {
      name: "exploding",
      async fetchQuotes() {
        throw new Error("provider down");
      },
    };
    const service = createPriceService({ repo, fetcher: exploding });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result).toMatchObject({ source: "QUOTE", asOf: "2026-07-29", stale: true });
  });

  it("never throws when persisting fails", async () => {
    const { repo } = fakeRepo();
    const brokenRepo = {
      ...repo,
      async upsertQuotes() {
        throw new Error("db down");
      },
    };
    const service = createPriceService({ repo: brokenRepo, fetcher: fakeFetcher([quote()]) });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result?.source).toBe("NONE");
  });

  it("does not ask the provider for a security with no symbol on that date", async () => {
    const { repo } = fakeRepo();
    const fetcher = fakeFetcher([]);
    const service = createPriceService({ repo, fetcher });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security({ symbol: null })],
      asOf: "2026-08-01",
    });

    expect(fetcher.batches.flat()).toHaveLength(0);
    expect(result?.source).toBe("NONE");
  });

  it("ignores a quote returned in a currency other than the security's", async () => {
    const { repo } = fakeRepo();
    const service = createPriceService({
      repo,
      fetcher: fakeFetcher([quote({ currency: "CAD" })]),
    });

    const [result] = await service.resolvePrices({
      householdId: "hh-1",
      securities: [security()],
      asOf: "2026-08-01",
    });

    expect(result?.source).toBe("NONE");
  });

  it("resolves several securities independently in one call", async () => {
    const { repo } = fakeRepo({
      quotes: [quote({ securityId: "sec-xiu", currency: "CAD", asOf: "2026-07-30" })],
      overrides: [
        { securityId: "sec-msft", asOf: "2026-08-01", priceMinor: 1n, note: "mark" },
      ],
    });
    const service = createPriceService({ repo, fetcher: fakeFetcher([quote()]) });

    const results = await service.resolvePrices({
      householdId: "hh-1",
      securities: [
        security(),
        security({ id: "sec-msft", symbol: "MSFT" }),
        security({ id: "sec-xiu", symbol: "XIU", exchange: "TSX", currency: "CAD" }),
      ],
      asOf: "2026-08-01",
    });

    expect(results.map((r) => [r.securityId, r.source, r.stale])).toEqual([
      ["sec-aapl", "QUOTE", false],
      ["sec-msft", "OVERRIDE", false],
      ["sec-xiu", "QUOTE", true],
    ]);
  });
});

describe("createQuoteFetcher", () => {
  it("defaults to the fixture provider when no API key is configured", () => {
    expect(createQuoteFetcher({}).name).toBe("fixture");
    expect(createQuoteFetcher({ TWELVEDATA_API_KEY: "   " }).name).toBe("fixture");
  });

  it("selects Twelve Data when an API key is configured", () => {
    expect(createQuoteFetcher({ TWELVEDATA_API_KEY: "KEY" }).name).toBe("twelvedata");
  });

  it("the fixture fetcher answers from in-memory quotes with no network", async () => {
    const fetcher = fixtureQuoteFetcher(
      new FixtureMarketDataProvider([quote({ source: "fixture" })]),
    );

    const quotes = await fetcher.fetchQuotes([
      {
        securityId: "sec-aapl",
        symbol: "AAPL",
        exchange: "NASDAQ",
        currency: "USD",
        minorUnits: 2,
        asOf: "2026-08-01",
      },
    ]);

    expect(quotes.map((q) => q.priceMinor)).toEqual([10000n]);
  });
});
