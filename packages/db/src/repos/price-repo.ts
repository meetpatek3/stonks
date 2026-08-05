import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { PriceOverride, PriceQuote } from "@stonks/ledger";
import type { Db } from "../client.js";
import { currency, priceOverride, priceQuote, security } from "../schema/index.js";

/** A manual price as entered: the domain override plus the audit trail of who recorded it. */
export type PriceOverrideInput = PriceOverride & { createdBy: string };

export type SecurityPriceRecord = {
  id: string;
  currency: string;
  minorUnits: number;
};

export interface PriceRepo {
  /** Shared security identity and its own price currency. */
  getSecurity(securityId: string): Promise<SecurityPriceRecord | null>;
  /**
   * Manual prices for a household, latest-first per (security, as_of) with superseded rows
   * filtered out, so `resolvePrice` sees exactly one override per security and date.
   */
  listOverrides(householdId: string): Promise<PriceOverride[]>;
  /** Append-only: records a new manual price; never updates an existing one. */
  insertOverride(householdId: string, override: PriceOverrideInput): Promise<void>;
  /** Idempotent per (security, currency, as_of) — a re-fetch corrects the stored quote. */
  upsertQuotes(quotes: readonly PriceQuote[]): Promise<void>;
  /** The most recent quote at or before `asOf`, or null. Never invents a price. */
  latestQuoteAsOf(
    securityId: string,
    currency: string,
    asOf: string,
  ): Promise<PriceQuote | null>;
}

export function createPriceRepo(db: Db): PriceRepo {
  return {
    async getSecurity(securityId) {
      const [row] = await db
        .select({
          id: security.id,
          currency: security.currency,
          minorUnits: currency.minorUnits,
        })
        .from(security)
        .innerJoin(currency, eq(security.currency, currency.code))
        .where(eq(security.id, securityId))
        .limit(1);
      return row ?? null;
    },
    async listOverrides(householdId) {
      const rows = await db
        .selectDistinctOn([priceOverride.securityId, priceOverride.asOf])
        .from(priceOverride)
        .where(eq(priceOverride.householdId, householdId))
        .orderBy(
          priceOverride.securityId,
          priceOverride.asOf,
          desc(priceOverride.createdAt),
          desc(priceOverride.id),
        );

      return rows.map((row) => ({
        securityId: row.securityId,
        asOf: row.asOf,
        priceMinor: row.priceMinor,
        note: row.note,
      }));
    },

    async insertOverride(householdId, override) {
      await db.insert(priceOverride).values({
        householdId,
        securityId: override.securityId,
        asOf: override.asOf,
        priceMinor: override.priceMinor,
        note: override.note,
        createdBy: override.createdBy,
      });
    },

    async upsertQuotes(quotes) {
      if (quotes.length === 0) return;

      await db
        .insert(priceQuote)
        .values(
          quotes.map((q) => ({
            securityId: q.securityId,
            currency: q.currency,
            asOf: q.asOf,
            priceMinor: q.priceMinor,
            source: q.source,
            fetchedAt: new Date(q.fetchedAt),
          })),
        )
        .onConflictDoUpdate({
          target: [priceQuote.securityId, priceQuote.currency, priceQuote.asOf],
          set: {
            priceMinor: sql`excluded.price_minor`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },

    async latestQuoteAsOf(securityId, currency, asOf) {
      const [row] = await db
        .select()
        .from(priceQuote)
        .where(
          and(
            eq(priceQuote.securityId, securityId),
            eq(priceQuote.currency, currency),
            lte(priceQuote.asOf, asOf),
          ),
        )
        .orderBy(desc(priceQuote.asOf))
        .limit(1);

      if (!row) return null;

      return {
        securityId: row.securityId,
        currency: row.currency,
        asOf: row.asOf,
        priceMinor: row.priceMinor,
        source: row.source,
        fetchedAt: row.fetchedAt.toISOString(),
      };
    },
  };
}
