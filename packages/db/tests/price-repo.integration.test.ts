import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePrice } from "@stonks/ledger";
import type { MarketDataProvider } from "@stonks/ledger";
import { createDb } from "../src/client.js";
import {
  currency,
  household,
  priceOverride,
  priceQuote,
  security,
  securitySymbol,
} from "../src/schema/index.js";
import { createPriceRepo } from "../src/repos/price-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("price repo integration", () => {
  const db = createDb(databaseUrl!);
  const repo = createPriceRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdId = crypto.randomUUID();
  const otherHouseholdId = crypto.randomUUID();
  const securityId = `sec-${suffix}`;
  const otherSecurityId = `sec-other-${suffix}`;

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();
    await db.insert(household).values([
      { id: householdId, reportingCurrency: "CAD" },
      { id: otherHouseholdId, reportingCurrency: "CAD" },
    ]);
    await db.insert(security).values([
      { id: securityId, name: "Acme Corp", type: "EQUITY", currency: "CAD" },
      { id: otherSecurityId, name: "Beta Corp", type: "EQUITY", currency: "CAD" },
    ]);
  });

  afterAll(async () => {
    await db.delete(priceOverride).where(eq(priceOverride.securityId, securityId));
    await db.delete(priceQuote).where(eq(priceQuote.securityId, securityId));
    await db.delete(securitySymbol).where(eq(securitySymbol.securityId, securityId));
    await db.delete(security).where(eq(security.id, securityId));
    await db.delete(security).where(eq(security.id, otherSecurityId));
    await db.delete(household).where(eq(household.id, householdId));
    await db.delete(household).where(eq(household.id, otherHouseholdId));
  });

  it("identifies a security independently of its ticker symbol", async () => {
    // Same security, symbol changed and re-listed on another exchange.
    await db.insert(securitySymbol).values([
      {
        securityId,
        symbol: "ACM",
        exchange: "TSX",
        effectiveFrom: "2020-01-01",
        effectiveTo: "2023-06-30",
      },
      {
        securityId,
        symbol: "ACME",
        exchange: "TSX",
        effectiveFrom: "2023-07-01",
        effectiveTo: null,
      },
      {
        securityId,
        symbol: "ACME",
        exchange: "NYSE",
        effectiveFrom: "2023-07-01",
        effectiveTo: null,
      },
    ]);

    const rows = await db
      .select()
      .from(securitySymbol)
      .where(eq(securitySymbol.securityId, securityId));

    // Three symbol rows, one security — a rename or cross-listing cannot fork the position.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.securityId)).size).toBe(1);
  });

  it("upserts quotes and reads the most recent quote at or before a date", async () => {
    await repo.upsertQuotes([
      {
        securityId,
        currency: "CAD",
        asOf: "2024-01-02",
        priceMinor: 10_000n,
        source: "TEST",
        fetchedAt: "2024-01-02T21:00:00.000Z",
      },
      {
        securityId,
        currency: "CAD",
        asOf: "2024-01-05",
        priceMinor: 10_550n,
        source: "TEST",
        fetchedAt: "2024-01-05T21:00:00.000Z",
      },
    ]);

    // Exact hit.
    const exact = await repo.latestQuoteAsOf(securityId, "CAD", "2024-01-05");
    expect(exact?.priceMinor).toBe(10_550n);
    expect(typeof exact?.priceMinor).toBe("bigint");
    expect(exact?.asOf).toBe("2024-01-05");
    expect(exact?.source).toBe("TEST");

    // Weekend / holiday: falls back to the most recent prior quote, never invents one.
    const stale = await repo.latestQuoteAsOf(securityId, "CAD", "2024-01-04");
    expect(stale?.asOf).toBe("2024-01-02");
    expect(stale?.priceMinor).toBe(10_000n);

    // Before any quote exists there is no price at all.
    expect(await repo.latestQuoteAsOf(securityId, "CAD", "2023-12-31")).toBeNull();

    // Re-fetching the same day replaces the quote rather than duplicating it.
    await repo.upsertQuotes([
      {
        securityId,
        currency: "CAD",
        asOf: "2024-01-05",
        priceMinor: 10_575n,
        source: "TEST_CORRECTED",
        fetchedAt: "2024-01-06T02:00:00.000Z",
      },
    ]);
    const corrected = await repo.latestQuoteAsOf(securityId, "CAD", "2024-01-05");
    expect(corrected?.priceMinor).toBe(10_575n);
    expect(corrected?.source).toBe("TEST_CORRECTED");

    const allRows = await db
      .select()
      .from(priceQuote)
      .where(eq(priceQuote.securityId, securityId));
    expect(allRows).toHaveLength(2);
  });

  it("keeps overrides append-only and returns the latest per security and date", async () => {
    await repo.insertOverride(householdId, {
      securityId,
      asOf: "2024-01-05",
      priceMinor: 11_000n,
      note: "first manual mark",
      createdBy: "meet",
    });
    await repo.insertOverride(householdId, {
      securityId,
      asOf: "2024-01-05",
      priceMinor: 11_250n,
      note: "corrected manual mark",
      createdBy: "meet",
    });

    // Both rows survive — the manual price history stays auditable.
    const persisted = await db
      .select()
      .from(priceOverride)
      .where(eq(priceOverride.securityId, securityId));
    expect(persisted).toHaveLength(2);
    expect(persisted.every((r) => typeof r.priceMinor === "bigint")).toBe(true);

    // The repo surfaces only the latest override for that security and date.
    const overrides = await repo.listOverrides(householdId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.priceMinor).toBe(11_250n);
    expect(overrides[0]!.note).toBe("corrected manual mark");
  });

  it("scopes overrides to their household", async () => {
    await repo.insertOverride(otherHouseholdId, {
      securityId,
      asOf: "2024-01-05",
      priceMinor: 99_999n,
      note: "another household's judgement",
      createdBy: "someone-else",
    });

    const mine = await repo.listOverrides(householdId);
    expect(mine.map((o) => o.priceMinor)).toEqual([11_250n]);

    const theirs = await repo.listOverrides(otherHouseholdId);
    expect(theirs.map((o) => o.priceMinor)).toEqual([99_999n]);
  });

  it("feeds resolvePrice: the household override beats the shared quote", async () => {
    const provider: MarketDataProvider = {
      async getQuote(id, asOf, cur) {
        return repo.latestQuoteAsOf(id, cur, asOf);
      },
    };

    const overrides = await repo.listOverrides(householdId);

    const overridden = await resolvePrice({
      securityId,
      asOf: "2024-01-05",
      currency: "CAD",
      overrides,
      provider,
    });
    expect(overridden?.priceMinor).toBe(11_250n);

    const quoted = await resolvePrice({
      securityId,
      asOf: "2024-01-02",
      currency: "CAD",
      overrides,
      provider,
    });
    expect(quoted?.priceMinor).toBe(10_000n);

    const unknown = await resolvePrice({
      securityId,
      asOf: "2023-12-31",
      currency: "CAD",
      overrides,
      provider,
    });
    expect(unknown).toBeNull();
  });
});
