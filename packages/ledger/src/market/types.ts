import type { SecurityId } from "../ledger/types.js";

export type PriceQuote = {
  securityId: SecurityId;
  currency: string;
  asOf: string; // YYYY-MM-DD
  priceMinor: bigint;
  source: string;
  fetchedAt: string; // ISO timestamp
};

export type PriceOverride = {
  securityId: SecurityId;
  asOf: string;
  priceMinor: bigint;
  note: string;
};

export interface MarketDataProvider {
  getQuote(securityId: SecurityId, asOf: string, currency: string): Promise<PriceQuote | null>;
}

/** Resolve override first, else provider quote. Never invents a price. */
export async function resolvePrice(args: {
  securityId: SecurityId;
  asOf: string;
  currency: string;
  overrides: readonly PriceOverride[];
  provider: MarketDataProvider;
}): Promise<PriceQuote | PriceOverride | null> {
  const override = args.overrides.find(
    (o) =>
      o.securityId === args.securityId &&
      o.asOf === args.asOf,
  );
  if (override) return override;
  return args.provider.getQuote(args.securityId, args.asOf, args.currency);
}
