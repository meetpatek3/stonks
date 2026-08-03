import type { PriceQuote } from "@stonks/ledger";
import { decimalStringToMinor } from "./decimal";
import type { QuoteFetcher, QuoteRequest } from "./provider";

/**
 * Twelve Data adapter (https://twelvedata.com/docs#time-series).
 *
 * UNVERIFIED against the live API: it was written from the published docs
 * without an API key, so every assumption about the response shape is coded
 * defensively — anything unrecognised yields no quote rather than a wrong one.
 *
 * Two Twelve Data behaviours drive the shape of this code:
 *  - a failed request can arrive as HTTP 200 with `{"status":"error"}` in the
 *    body, per-request or per-symbol inside a batch;
 *  - a multi-symbol request returns an object keyed by symbol instead of a
 *    bare series.
 *
 * Free tier is ~800 requests/day, so symbols are batched: one request per
 * (exchange, date) group rather than one per security.
 */

const BASE_URL = "https://api.twelvedata.com/time_series";
const REQUEST_TIMEOUT_MS = 10_000;
/** Calendar days of history requested, so a weekend/holiday still yields the prior close. */
const LOOKBACK_DAYS = 10;
/** Twelve Data caps a batch at 8 symbols per request on the free plan; stay at or under it. */
const MAX_SYMBOLS_PER_REQUEST = 8;

export type TwelveDataOptions = {
  apiKey: string;
  /** Injected for tests; defaults to global `fetch`. Tests never hit the network. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
};

export function createTwelveDataFetcher(options: TwelveDataOptions): QuoteFetcher {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());

  return {
    name: "twelvedata",
    async fetchQuotes(requests) {
      const quotes: PriceQuote[] = [];
      for (const group of groupRequests(requests)) {
        const body = await fetchJson(buildUrl(group, options.apiKey), fetchImpl);
        if (body === null) continue;
        quotes.push(...quotesFromBody(body, group, now().toISOString()));
      }
      return quotes;
    },
  };
}

/** One HTTP request per (exchange, date), capped at the batch size limit. */
function groupRequests(requests: readonly QuoteRequest[]): QuoteRequest[][] {
  const byKey = new Map<string, QuoteRequest[]>();
  for (const request of requests) {
    if (request.symbol.trim() === "") continue;
    const key = `${request.exchange ?? ""}|${request.asOf}`;
    const group = byKey.get(key);
    if (group) group.push(request);
    else byKey.set(key, [request]);
  }

  const groups: QuoteRequest[][] = [];
  for (const group of byKey.values()) {
    for (let i = 0; i < group.length; i += MAX_SYMBOLS_PER_REQUEST) {
      groups.push(group.slice(i, i + MAX_SYMBOLS_PER_REQUEST));
    }
  }
  return groups;
}

function buildUrl(group: readonly QuoteRequest[], apiKey: string): string {
  const first = group[0]!;
  const symbols = [...new Set(group.map((r) => r.symbol))];

  const url = new URL(BASE_URL);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("start_date", shiftDays(first.asOf, -LOOKBACK_DAYS));
  url.searchParams.set("end_date", first.asOf);
  url.searchParams.set("order", "desc");
  if (first.exchange) url.searchParams.set("exchange", first.exchange);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

/** Date arithmetic on the UTC calendar; `asOf` is a plain YYYY-MM-DD. */
function shiftDays(asOf: string, days: number): string {
  const at = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return asOf;
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Returns the parsed body, or `null` for any failure — network error, timeout,
 * non-2xx status, non-JSON body. A provider failure must never throw into a
 * render path.
 */
async function fetchJson(
  url: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function quotesFromBody(
  body: unknown,
  group: readonly QuoteRequest[],
  fetchedAt: string,
): PriceQuote[] {
  if (!isRecord(body)) return [];
  if (body.status === "error") return [];

  // Single-symbol responses are a bare series; batches are keyed by symbol.
  if (Array.isArray(body.values)) {
    const symbol = seriesSymbol(body) ?? group[0]?.symbol;
    return group
      .filter((request) => matchesSymbol(request.symbol, symbol))
      .flatMap((request) => toQuote(body, request, fetchedAt) ?? []);
  }

  return group.flatMap((request) => {
    const series = findSeries(body, request.symbol);
    if (!series) return [];
    return toQuote(series, request, fetchedAt) ?? [];
  });
}

/** Batch keys are the symbols as submitted; some responses key them `SYMBOL:EXCHANGE`. */
function findSeries(body: Record<string, unknown>, symbol: string): Record<string, unknown> | null {
  for (const [key, value] of Object.entries(body)) {
    if (isRecord(value) && matchesSymbol(symbol, key)) return value;
  }
  return null;
}

function matchesSymbol(symbol: string, candidate: string | undefined): boolean {
  if (candidate === undefined) return false;
  // Normalise both sides: a stored symbol may itself carry an exchange suffix.
  return bareSymbol(candidate) === bareSymbol(symbol);
}

function bareSymbol(symbol: string): string {
  return symbol.split(":")[0]!.trim().toUpperCase();
}

function seriesSymbol(series: Record<string, unknown>): string | undefined {
  const meta = series.meta;
  return isRecord(meta) && typeof meta.symbol === "string" ? meta.symbol : undefined;
}

/**
 * The most recent close at or before the requested date, carrying its own real
 * `asOf`. A gap (weekend, holiday, halt) is never papered over by relabelling
 * an older close as the requested date — the price service marks it stale.
 */
function toQuote(
  series: Record<string, unknown>,
  request: QuoteRequest,
  fetchedAt: string,
): PriceQuote | null {
  if (series.status === "error") return null;

  // A quote whose currency is not the one asked for cannot be relabelled — that
  // would silently treat a CAD mark as USD. Drop it instead.
  const meta = series.meta;
  if (isRecord(meta) && typeof meta.currency === "string") {
    if (meta.currency.toUpperCase() !== request.currency.toUpperCase()) return null;
  }

  const values = series.values;
  if (!Array.isArray(values)) return null;

  let best: { asOf: string; close: string } | null = null;
  for (const entry of values) {
    if (!isRecord(entry)) continue;
    if (typeof entry.datetime !== "string" || typeof entry.close !== "string") continue;
    const asOf = entry.datetime.slice(0, 10);
    if (asOf > request.asOf) continue;
    if (best === null || asOf > best.asOf) best = { asOf, close: entry.close };
  }
  if (best === null) return null;

  const priceMinor = decimalStringToMinor(best.close, request.minorUnits);
  if (priceMinor === null) return null;

  return {
    securityId: request.securityId,
    currency: request.currency,
    asOf: best.asOf,
    priceMinor,
    source: "twelvedata",
    fetchedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
