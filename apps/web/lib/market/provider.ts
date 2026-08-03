import { FixtureMarketDataProvider } from "@stonks/ledger";
import type { MarketDataProvider, PriceQuote, SecurityId } from "@stonks/ledger";
import { createTwelveDataFetcher } from "./twelve-data";

/**
 * Everything a provider needs to price one security on one date.
 *
 * The domain's `MarketDataProvider.getQuote` is keyed by `SecurityId`, which no
 * external API knows about, so the request carries the resolved ticker as well
 * as the currency the price must be denominated in and that currency's
 * minor-unit scale.
 */
export type QuoteRequest = {
  securityId: SecurityId;
  symbol: string;
  exchange: string | null;
  /** The security's own trading currency — the only currency a quote is accepted in. */
  currency: string;
  minorUnits: number;
  asOf: string; // YYYY-MM-DD
};

/**
 * A batch price source.
 *
 * Deliberately *not* `MarketDataProvider`: that interface is per-security and
 * carries no ticker, and free-tier request budgets (Twelve Data allows ~800
 * calls/day) make one HTTP call per security untenable. `resolvePrice` still
 * runs against a `MarketDataProvider` — the price service backs it with the
 * price repo, so persisted quotes are the cache and this fetcher is only
 * reached on a miss.
 *
 * `fetchQuotes` must never reject: a provider failure is "no quotes", which
 * flows through `resolvePrice` as `null`. Missing data stays visibly missing.
 */
export interface QuoteFetcher {
  /** Recorded on persisted quotes as `PriceQuote.source`. */
  readonly name: string;
  fetchQuotes(requests: readonly QuoteRequest[]): Promise<readonly PriceQuote[]>;
}

/** Adapt any in-memory `MarketDataProvider` (the fixture provider) to the batch shape. */
export function fixtureQuoteFetcher(provider: MarketDataProvider): QuoteFetcher {
  return {
    name: "fixture",
    async fetchQuotes(requests) {
      const quotes: PriceQuote[] = [];
      for (const request of requests) {
        const quote = await provider.getQuote(
          request.securityId,
          request.asOf,
          request.currency,
        );
        if (quote) quotes.push(quote);
      }
      return quotes;
    },
  };
}

/**
 * Select the price source from the environment.
 *
 * Twelve Data only when `TWELVEDATA_API_KEY` is set; otherwise the fixture
 * provider. Self-hosting with no market-data account must work, so the default
 * has no external dependency — it simply reports no quotes, and the UI shows
 * prices as unknown rather than inventing them.
 */
export function createQuoteFetcher(
  env: Record<string, string | undefined> = process.env,
): QuoteFetcher {
  const apiKey = env.TWELVEDATA_API_KEY?.trim();
  if (!apiKey) {
    // No quotes rather than wrong quotes: without a configured source, prices
    // are simply unknown. Tests and demos pass their own fixture quotes to
    // `fixtureQuoteFetcher` directly.
    return fixtureQuoteFetcher(new FixtureMarketDataProvider([]));
  }
  return createTwelveDataFetcher({ apiKey });
}
