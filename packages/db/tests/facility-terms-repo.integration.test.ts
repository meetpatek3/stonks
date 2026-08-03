import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import {
  account,
  benchmarkRate,
  benchmarkRatePoint,
  creditFacilityTerms,
  currency,
  household,
} from "../src/schema/index.js";
import { createFacilityTermsRepo } from "../src/repos/facility-terms-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("facility terms repo integration", () => {
  const db = createDb(databaseUrl!);
  const repo = createFacilityTermsRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdId = crypto.randomUUID();
  const otherHouseholdId = crypto.randomUUID();
  const facilityId = `facility-${suffix}`;
  const otherFacilityId = `facility-other-${suffix}`;
  const cashId = `cash-${suffix}`;
  let benchmarkId = "";
  let otherBenchmarkId = "";

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();

    await db.insert(household).values([
      { id: householdId, reportingCurrency: "CAD" },
      { id: otherHouseholdId, reportingCurrency: "CAD" },
    ]);

    await db.insert(account).values([
      {
        id: facilityId,
        householdId,
        type: "CREDIT_FACILITY",
        currency: "CAD",
        name: "Investment loan",
      },
      {
        id: cashId,
        householdId,
        type: "CASH",
        currency: "CAD",
        name: "Chequing",
      },
      {
        id: otherFacilityId,
        householdId: otherHouseholdId,
        type: "CREDIT_FACILITY",
        currency: "CAD",
        name: "Other household loan",
      },
    ]);

    const [bench] = await db
      .insert(benchmarkRate)
      .values({ name: `Prime-${suffix}` })
      .returning();
    const [otherBench] = await db
      .insert(benchmarkRate)
      .values({ name: `Other-${suffix}` })
      .returning();
    benchmarkId = bench!.id;
    otherBenchmarkId = otherBench!.id;

    await db.insert(benchmarkRatePoint).values([
      { benchmarkId, effectiveDate: "2024-01-01", rateBps: 500 },
      { benchmarkId, effectiveDate: "2024-06-01", rateBps: 525 },
      { benchmarkId: otherBenchmarkId, effectiveDate: "2024-01-01", rateBps: 100 },
    ]);

    await db.insert(creditFacilityTerms).values([
      {
        accountId: facilityId,
        benchmarkId,
        spreadBps: 50,
        dayCount: "ACT_365",
        postingDayRule: "MONTH_END",
        capitalizeInterest: true,
        effectiveFrom: "2024-01-01",
        effectiveTo: "2024-05-31",
      },
      {
        accountId: facilityId,
        benchmarkId,
        spreadBps: 75,
        dayCount: "ACT_365",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: false,
        effectiveFrom: "2024-06-01",
        effectiveTo: null,
      },
      {
        accountId: otherFacilityId,
        benchmarkId: otherBenchmarkId,
        spreadBps: 10,
        dayCount: "ACT_360",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: true,
        effectiveFrom: "2024-01-01",
        effectiveTo: null,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(creditFacilityTerms).where(eq(creditFacilityTerms.accountId, facilityId));
    await db
      .delete(creditFacilityTerms)
      .where(eq(creditFacilityTerms.accountId, otherFacilityId));
    await db.delete(benchmarkRatePoint).where(eq(benchmarkRatePoint.benchmarkId, benchmarkId));
    await db
      .delete(benchmarkRatePoint)
      .where(eq(benchmarkRatePoint.benchmarkId, otherBenchmarkId));
    await db.delete(benchmarkRate).where(eq(benchmarkRate.id, benchmarkId));
    await db.delete(benchmarkRate).where(eq(benchmarkRate.id, otherBenchmarkId));
    await db.delete(account).where(eq(account.id, facilityId));
    await db.delete(account).where(eq(account.id, cashId));
    await db.delete(account).where(eq(account.id, otherFacilityId));
    await db.delete(household).where(eq(household.id, householdId));
    await db.delete(household).where(eq(household.id, otherHouseholdId));
  });

  it("returns the terms row effective on asOf, not a superseded or future row", async () => {
    const early = await repo.listEffectiveTerms(householdId, "2024-03-15");
    expect(early).toHaveLength(1);
    expect(early[0]).toEqual({
      terms: {
        facilityAccountId: facilityId,
        spreadBps: 50,
        dayCount: "ACT_365",
        postingDayRule: "MONTH_END",
        capitalizeInterest: true,
      },
      benchmarkId,
      effectiveFrom: "2024-01-01",
      effectiveTo: "2024-05-31",
    });

    const late = await repo.listEffectiveTerms(householdId, "2024-07-01");
    expect(late).toHaveLength(1);
    expect(late[0]!.terms.spreadBps).toBe(75);
    expect(late[0]!.terms.postingDayRule).toBe("CALENDAR_DAY");
    expect(late[0]!.terms.capitalizeInterest).toBe(false);
    expect(late[0]!.effectiveTo).toBeNull();
  });

  it("does not return terms for another household's facilities", async () => {
    const rows = await repo.listEffectiveTerms(householdId, "2024-07-01");
    expect(rows.map((r) => r.terms.facilityAccountId)).toEqual([facilityId]);
  });

  it("returns an empty list when no terms are effective on asOf", async () => {
    const rows = await repo.listEffectiveTerms(householdId, "2023-12-31");
    expect(rows).toEqual([]);
  });

  it("loads benchmark curves oldest-first and never invents points", async () => {
    const curves = await repo.listBenchmarkCurves([benchmarkId, crypto.randomUUID()]);
    expect(curves.get(benchmarkId)).toEqual({
      name: `Prime-${suffix}`,
      points: [
        { effectiveDate: "2024-01-01", rateBps: 500 },
        { effectiveDate: "2024-06-01", rateBps: 525 },
      ],
    });
    // Unknown benchmark id is omitted — not an empty invented curve under that id.
    expect(curves.size).toBe(1);
  });
});
