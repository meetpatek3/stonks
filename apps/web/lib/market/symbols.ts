import { currency as currencyTable, eq, security, securitySymbol } from "@stonks/db";
import type { Db } from "@stonks/db";
import { inArray } from "drizzle-orm";
import type { SecurityRef } from "./price-service";

/** One `security_symbol` row, as the resolver needs it. */
export type SymbolRow = {
  securityId: string;
  symbol: string;
  exchange: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // null = still current
};

/**
 * The symbol in force for a security on a date.
 *
 * `security_symbol` has **no database-level guarantee** that effective ranges
 * do not overlap (drizzle cannot emit an exclusion constraint), so overlapping
 * rows are possible and must not produce an arbitrary pick. The rule is: among
 * rows whose range covers the date, take the greatest `effective_from`; ties
 * break on `(symbol, exchange)` so the answer is stable regardless of row
 * order. Returns `null` when no row covers the date — a security with no symbol
 * is simply not quotable, which is a "no price", not an error.
 */
export function resolveSymbolAsOf(
  rows: readonly SymbolRow[],
  asOf: string,
): SymbolRow | null {
  const covering = rows.filter(
    (r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf),
  );
  if (covering.length === 0) return null;

  return covering.reduce((best, r) => {
    if (r.effectiveFrom !== best.effectiveFrom) {
      return r.effectiveFrom > best.effectiveFrom ? r : best;
    }
    if (r.symbol !== best.symbol) return r.symbol < best.symbol ? r : best;
    return r.exchange < best.exchange ? r : best;
  });
}

/**
 * Load the securities the price service needs: identity, trading currency and
 * its minor-unit scale, plus the symbol in force on `asOf`.
 */
export async function loadSecurityRefs(
  db: Db,
  securityIds: readonly string[],
  asOf: string,
): Promise<SecurityRef[]> {
  if (securityIds.length === 0) return [];

  const ids = [...new Set(securityIds)];

  const securities = await db
    .select({
      id: security.id,
      currency: security.currency,
      minorUnits: currencyTable.minorUnits,
    })
    .from(security)
    .innerJoin(currencyTable, eq(security.currency, currencyTable.code))
    .where(inArray(security.id, ids));

  const symbolRows = await db
    .select({
      securityId: securitySymbol.securityId,
      symbol: securitySymbol.symbol,
      exchange: securitySymbol.exchange,
      effectiveFrom: securitySymbol.effectiveFrom,
      effectiveTo: securitySymbol.effectiveTo,
    })
    .from(securitySymbol)
    .where(inArray(securitySymbol.securityId, ids));

  const bySecurity = new Map<string, SymbolRow[]>();
  for (const row of symbolRows) {
    const list = bySecurity.get(row.securityId);
    if (list) list.push(row);
    else bySecurity.set(row.securityId, [row]);
  }

  return securities.map((s) => {
    const resolved = resolveSymbolAsOf(bySecurity.get(s.id) ?? [], asOf);
    return {
      id: s.id,
      currency: s.currency,
      minorUnits: s.minorUnits,
      symbol: resolved?.symbol ?? null,
      exchange: resolved?.exchange ?? null,
    };
  });
}
