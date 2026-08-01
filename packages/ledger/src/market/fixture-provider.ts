import type { SecurityId } from "../ledger/types.js";
import type { MarketDataProvider, PriceQuote } from "./types.js";

/** Fixture-driven provider for demos and tests — no network. */
export class FixtureMarketDataProvider implements MarketDataProvider {
  constructor(private readonly quotes: readonly PriceQuote[]) {}

  async getQuote(
    securityId: SecurityId,
    asOf: string,
    currency: string,
  ): Promise<PriceQuote | null> {
    const matches = this.quotes.filter(
      (q) =>
        q.securityId === securityId &&
        q.currency === currency &&
        q.asOf <= asOf,
    );
    if (matches.length === 0) return null;
    return matches.reduce((best, q) => (q.asOf > best.asOf ? q : best));
  }
}
