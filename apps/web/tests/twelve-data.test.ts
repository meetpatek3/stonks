import { describe, expect, it } from "vitest";
import { createTwelveDataFetcher } from "@/lib/market/twelve-data";
import type { QuoteRequest } from "@/lib/market/provider";

const request = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  securityId: "sec-aapl",
  symbol: "AAPL",
  exchange: "NASDAQ",
  currency: "USD",
  minorUnits: 2,
  asOf: "2026-08-01",
  ...over,
});

/** A fetch double: records calls, replays canned JSON bodies in order. */
function fakeFetch(bodies: readonly unknown[], status = 200) {
  const calls: string[] = [];
  let i = 0;
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, calls };
}

const okSeries = (values: { datetime: string; close: string }[], currency = "USD") => ({
  meta: { symbol: "AAPL", currency, exchange: "NASDAQ" },
  values,
  status: "ok",
});

describe("createTwelveDataFetcher", () => {
  it("returns a quote in bigint minor units from the day's close", async () => {
    const { impl, calls } = fakeFetch([okSeries([{ datetime: "2026-08-01", close: "213.4567" }])]);
    const fetcher = createTwelveDataFetcher({
      apiKey: "KEY",
      fetchImpl: impl,
      now: () => new Date("2026-08-01T20:00:00Z"),
    });

    const quotes = await fetcher.fetchQuotes([request()]);

    expect(quotes).toEqual([
      {
        securityId: "sec-aapl",
        currency: "USD",
        asOf: "2026-08-01",
        priceMinor: 21346n,
        source: "twelvedata",
        fetchedAt: "2026-08-01T20:00:00.000Z",
      },
    ]);
    expect(calls[0]).toContain("api.twelvedata.com");
    expect(calls[0]).toContain("symbol=AAPL");
    expect(calls[0]).toContain("apikey=KEY");
  });

  it("returns the most recent close at or before the requested date, with its real asOf", async () => {
    const { impl } = fakeFetch([
      okSeries([
        { datetime: "2026-08-04", close: "10.00" }, // after the requested date
        { datetime: "2026-07-31", close: "9.50" },
        { datetime: "2026-07-30", close: "9.00" },
      ]),
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const [quote] = await fetcher.fetchQuotes([request()]);

    expect(quote?.asOf).toBe("2026-07-31");
    expect(quote?.priceMinor).toBe(950n);
  });

  it("batches symbols that share an exchange into one request", async () => {
    const { impl, calls } = fakeFetch([
      {
        AAPL: okSeries([{ datetime: "2026-08-01", close: "1.00" }]),
        MSFT: okSeries([{ datetime: "2026-08-01", close: "2.00" }]),
      },
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const quotes = await fetcher.fetchQuotes([
      request(),
      request({ securityId: "sec-msft", symbol: "MSFT" }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("symbol=AAPL%2CMSFT");
    expect(quotes.map((q) => [q.securityId, q.priceMinor])).toEqual([
      ["sec-aapl", 100n],
      ["sec-msft", 200n],
    ]);
  });

  it("issues one request per exchange", async () => {
    const { impl, calls } = fakeFetch([okSeries([{ datetime: "2026-08-01", close: "1.00" }])]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    await fetcher.fetchQuotes([
      request(),
      request({ securityId: "sec-xiu", symbol: "XIU", exchange: "TSX", currency: "CAD" }),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls.some((u) => u.includes("exchange=NASDAQ"))).toBe(true);
    expect(calls.some((u) => u.includes("exchange=TSX"))).toBe(true);
  });

  it("resolves to no quotes on a 200 response carrying status: error", async () => {
    const { impl } = fakeFetch([{ code: 429, message: "API credits exceeded", status: "error" }]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    await expect(fetcher.fetchQuotes([request()])).resolves.toEqual([]);
  });

  it("resolves to no quotes on an HTTP failure", async () => {
    const { impl } = fakeFetch([{ message: "boom" }], 500);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    await expect(fetcher.fetchQuotes([request()])).resolves.toEqual([]);
  });

  it("resolves to no quotes when the network call rejects", async () => {
    const fetcher = createTwelveDataFetcher({
      apiKey: "KEY",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(fetcher.fetchQuotes([request()])).resolves.toEqual([]);
  });

  it("resolves to no quotes when the body is not JSON", async () => {
    const fetcher = createTwelveDataFetcher({
      apiKey: "KEY",
      fetchImpl: async () => new Response("<html>gateway</html>", { status: 200 }),
    });

    await expect(fetcher.fetchQuotes([request()])).resolves.toEqual([]);
  });

  it("skips a symbol whose close is not a plain decimal string", async () => {
    const { impl } = fakeFetch([
      {
        AAPL: okSeries([{ datetime: "2026-08-01", close: "n/a" }]),
        MSFT: okSeries([{ datetime: "2026-08-01", close: "2.00" }]),
      },
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const quotes = await fetcher.fetchQuotes([
      request(),
      request({ securityId: "sec-msft", symbol: "MSFT" }),
    ]);

    expect(quotes.map((q) => q.securityId)).toEqual(["sec-msft"]);
  });

  it("skips a quote whose reported currency is not the currency asked for", async () => {
    const { impl } = fakeFetch([
      okSeries([{ datetime: "2026-08-01", close: "10.00" }], "CAD"),
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    await expect(fetcher.fetchQuotes([request({ currency: "USD" })])).resolves.toEqual([]);
  });

  it("skips a per-symbol error inside a batch response and keeps the rest", async () => {
    const { impl } = fakeFetch([
      {
        AAPL: { code: 404, message: "symbol not found", status: "error" },
        MSFT: okSeries([{ datetime: "2026-08-01", close: "2.00" }]),
      },
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const quotes = await fetcher.fetchQuotes([
      request(),
      request({ securityId: "sec-msft", symbol: "MSFT" }),
    ]);

    expect(quotes.map((q) => q.securityId)).toEqual(["sec-msft"]);
  });

  it("splits a group larger than the batch cap into whole requests, losing no symbol", async () => {
    const symbols = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"];
    const { impl, calls } = fakeFetch([
      Object.fromEntries(
        symbols.map((s) => [s, okSeries([{ datetime: "2026-08-01", close: "1.00" }])]),
      ),
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const quotes = await fetcher.fetchQuotes(
      symbols.map((s) => request({ securityId: `sec-${s}`, symbol: s })),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("symbol=S1%2CS2%2CS3%2CS4%2CS5%2CS6%2CS7%2CS8");
    expect(calls[1]).toContain("symbol=S9");
    expect(quotes.map((q) => q.securityId)).toEqual(symbols.map((s) => `sec-${s}`));
  });

  it("matches a response key against a request symbol that carries an exchange suffix", async () => {
    const { impl } = fakeFetch([
      { AAPL: okSeries([{ datetime: "2026-08-01", close: "3.00" }]) },
      { AAPL: okSeries([{ datetime: "2026-08-01", close: "3.00" }]) },
    ]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    const quotes = await fetcher.fetchQuotes([
      request({ symbol: "AAPL:NASDAQ" }),
      request({ securityId: "sec-msft", symbol: "MSFT" }),
    ]);

    expect(quotes.map((q) => [q.securityId, q.priceMinor])).toEqual([["sec-aapl", 300n]]);
  });

  it("makes no request at all for an empty batch", async () => {
    const { impl, calls } = fakeFetch([okSeries([])]);
    const fetcher = createTwelveDataFetcher({ apiKey: "KEY", fetchImpl: impl });

    await expect(fetcher.fetchQuotes([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
