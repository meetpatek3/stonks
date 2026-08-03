import { resolvePrice } from "@stonks/ledger";
import type { MarketDataProvider, PriceOverride, PriceQuote, SecurityId } from "@stonks/ledger";
import type { PriceRepo } from "@stonks/db";
import type { QuoteFetcher, QuoteRequest } from "./provider";

/**
 * Price resolution: overrides, then quotes, then nothing.
 *
 * The domain rule lives in `resolvePrice` (`packages/ledger/src/market/types.ts`)
 * and is not reimplemented here. This service supplies the two things it needs
 * — the household's overrides and a `MarketDataProvider` — and tags the result
 * so a caller can render provenance honestly.
 *
 * Caching is persistence: a fetched quote is written through the price repo,
 * and the provider handed to `resolvePrice` reads from that repo, so a repeated
 * request for the same security and date costs no API call. There is no
 * separate cache layer.
 *
 * Nothing here throws. Every repo and provider call is contained; a failure
 * degrades to "no price", which renders as unknown. A missing price is never
 * substituted with a nearby one — an older quote is returned with its own real
 * `asOf` and `stale: true`.
 */

export type PriceSource = "OVERRIDE" | "QUOTE" | "NONE";

/** A security to price, with its trading currency and the symbol in force on the date. */
export type SecurityRef = {
  id: string;
  /** The security's own trading currency — the only currency it is priced in here. */
  currency: string;
  minorUnits: number;
  symbol: string | null;
  exchange: string | null;
};

export type ResolvedPrice = {
  securityId: string;
  source: PriceSource;
  /** `null` exactly when `source` is `NONE`. Never a substituted or zero price. */
  priceMinor: bigint | null;
  /**
   * The currency the price is denominated in — always the security's own.
   *
   * `price_override` carries no currency: an override is implicitly a mark in
   * `security.currency`, and `resolvePrice` returns an override regardless of
   * the currency asked for. This service therefore only ever resolves in the
   * security's own currency, which makes that mismatch structurally impossible
   * rather than silently wrong. Conversion into a reporting currency is the
   * read model's job, downstream of here.
   */
  currency: string;
  minorUnits: number;
  /** The date the price actually belongs to; `null` when there is no price. */
  asOf: string | null;
  requestedAsOf: string;
  /** True when `asOf` is older than `requestedAsOf`. */
  stale: boolean;
};

type PriceServiceRepo = Pick<PriceRepo, "listOverrides" | "upsertQuotes" | "latestQuoteAsOf">;

export type PriceServiceOptions = {
  repo: PriceServiceRepo;
  fetcher: QuoteFetcher;
  now?: () => Date;
};

export type ResolvePricesArgs = {
  householdId: string;
  securities: readonly SecurityRef[];
  asOf: string; // YYYY-MM-DD
};

export interface PriceService {
  resolvePrices(args: ResolvePricesArgs): Promise<ResolvedPrice[]>;
}

export function createPriceService(options: PriceServiceOptions): PriceService {
  const { repo, fetcher } = options;

  return {
    async resolvePrices({ householdId, securities, asOf }) {
      const overrides = await safely(() => repo.listOverrides(householdId), []);

      await refreshQuotes({ repo, fetcher, securities, overrides, asOf });

      const provider = repoProvider(repo);

      return Promise.all(
        securities.map(async (security) => {
          const resolved = await safely(
            () =>
              resolvePrice({
                securityId: security.id as SecurityId,
                asOf,
                currency: security.currency,
                overrides,
                provider,
              }),
            null,
          );
          return tag(security, asOf, resolved);
        }),
      );
    },
  };
}

/** Fetch the quotes that are actually missing, and persist them. */
async function refreshQuotes(args: {
  repo: PriceServiceRepo;
  fetcher: QuoteFetcher;
  securities: readonly SecurityRef[];
  overrides: readonly PriceOverride[];
  asOf: string;
}): Promise<void> {
  const { repo, fetcher, securities, overrides, asOf } = args;

  const requests: QuoteRequest[] = [];
  for (const security of securities) {
    // An override for the date wins outright, so fetching would spend a request
    // on a price that can never be used.
    if (overrides.some((o) => o.securityId === security.id && o.asOf === asOf)) continue;
    // No symbol on that date means nothing to ask an external API for.
    if (!security.symbol) continue;
    // A quote for the exact date is already the answer; the repo is the cache.
    const cached = await safely(
      () => repo.latestQuoteAsOf(security.id, security.currency, asOf),
      null,
    );
    if (cached?.asOf === asOf) continue;

    requests.push({
      securityId: security.id as SecurityId,
      symbol: security.symbol,
      exchange: security.exchange,
      currency: security.currency,
      minorUnits: security.minorUnits,
      asOf,
    });
  }

  if (requests.length === 0) return;

  const fetched = await safely(() => fetcher.fetchQuotes(requests), [] as readonly PriceQuote[]);
  const usable = fetched.filter((quote) =>
    securities.some((s) => s.id === quote.securityId && s.currency === quote.currency),
  );
  const deduped = dedupeByConflictKey(usable);
  if (deduped.length === 0) return;

  await safely(() => repo.upsertQuotes(deduped), undefined);
}

/**
 * Collapse rows sharing `(securityId, currency, asOf)`, last one winning.
 *
 * `upsertQuotes` issues a single `ON CONFLICT DO UPDATE`, and Postgres rejects a
 * batch that would touch the same row twice ("command cannot affect row a
 * second time"). A provider echoing a day twice would otherwise be a hard
 * error rather than a duplicate.
 */
function dedupeByConflictKey(quotes: readonly PriceQuote[]): PriceQuote[] {
  const byKey = new Map<string, PriceQuote>();
  for (const quote of quotes) {
    byKey.set(`${quote.securityId}|${quote.currency}|${quote.asOf}`, quote);
  }
  return [...byKey.values()];
}

/** A `MarketDataProvider` backed by persisted quotes — the cache `resolvePrice` reads. */
function repoProvider(repo: PriceServiceRepo): MarketDataProvider {
  return {
    async getQuote(securityId, asOf, currency) {
      return safely(() => repo.latestQuoteAsOf(securityId, currency, asOf), null);
    },
  };
}

function tag(
  security: SecurityRef,
  requestedAsOf: string,
  resolved: PriceQuote | PriceOverride | null,
): ResolvedPrice {
  const base = {
    securityId: security.id,
    currency: security.currency,
    minorUnits: security.minorUnits,
    requestedAsOf,
  };

  if (resolved === null) {
    return { ...base, source: "NONE", priceMinor: null, asOf: null, stale: false };
  }

  // `PriceQuote` carries a currency; `PriceOverride` does not.
  const source: PriceSource = "currency" in resolved ? "QUOTE" : "OVERRIDE";

  return {
    ...base,
    source,
    priceMinor: resolved.priceMinor,
    asOf: resolved.asOf,
    stale: resolved.asOf < requestedAsOf,
  };
}

/** Run an effect, swallowing failure into a fallback. Keeps failures out of render paths. */
async function safely<T>(effect: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await effect();
  } catch {
    return fallback;
  }
}
