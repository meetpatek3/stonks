import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type {
  BenchmarkRatePoint,
  DayCount,
  FacilityTerms,
  PostingDayRule,
} from "@stonks/ledger";
import type { Db } from "../client.js";
import {
  account,
  benchmarkRate,
  benchmarkRatePoint,
  creditFacilityTerms,
} from "../schema/index.js";

/** Effective terms for one facility, plus the benchmark they are priced off. */
export type FacilityTermsRecord = {
  terms: FacilityTerms;
  benchmarkId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type BenchmarkCurve = {
  name: string;
  points: BenchmarkRatePoint[];
};

export interface FacilityTermsRepo {
  /**
   * Terms effective on `asOf` for every CREDIT_FACILITY account in the
   * household. At most one row per facility (latest `effective_from` that
   * covers `asOf`). Facilities with no covering row are omitted — callers
   * must treat absence as "cannot model", not as a zero rate.
   */
  listEffectiveTerms(
    householdId: string,
    asOf: string,
  ): Promise<FacilityTermsRecord[]>;

  /**
   * Benchmark curves for the given ids. Unknown ids are omitted from the
   * map (never returned as an invented empty curve). Points are oldest-first.
   */
  listBenchmarkCurves(
    benchmarkIds: readonly string[],
  ): Promise<Map<string, BenchmarkCurve>>;
}

export function createFacilityTermsRepo(db: Db): FacilityTermsRepo {
  return {
    async listEffectiveTerms(householdId, asOf) {
      // Distinct-on the facility account, ordered so the latest covering
      // effective_from wins. A row covers asOf when
      //   effective_from <= asOf AND (effective_to IS NULL OR effective_to >= asOf).
      const rows = await db
        .selectDistinctOn([creditFacilityTerms.accountId], {
          accountId: creditFacilityTerms.accountId,
          benchmarkId: creditFacilityTerms.benchmarkId,
          spreadBps: creditFacilityTerms.spreadBps,
          dayCount: creditFacilityTerms.dayCount,
          postingDayRule: creditFacilityTerms.postingDayRule,
          capitalizeInterest: creditFacilityTerms.capitalizeInterest,
          effectiveFrom: creditFacilityTerms.effectiveFrom,
          effectiveTo: creditFacilityTerms.effectiveTo,
        })
        .from(creditFacilityTerms)
        .innerJoin(account, eq(creditFacilityTerms.accountId, account.id))
        .where(
          and(
            eq(account.householdId, householdId),
            eq(account.type, "CREDIT_FACILITY"),
            lte(creditFacilityTerms.effectiveFrom, asOf),
            or(
              isNull(creditFacilityTerms.effectiveTo),
              sql`${creditFacilityTerms.effectiveTo} >= ${asOf}`,
            ),
          ),
        )
        .orderBy(
          creditFacilityTerms.accountId,
          sql`${creditFacilityTerms.effectiveFrom} desc`,
        );

      return rows.map((row) => ({
        terms: {
          facilityAccountId: row.accountId,
          spreadBps: row.spreadBps,
          dayCount: row.dayCount as DayCount,
          postingDayRule: row.postingDayRule as PostingDayRule,
          capitalizeInterest: row.capitalizeInterest,
        },
        benchmarkId: row.benchmarkId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      }));
    },

    async listBenchmarkCurves(benchmarkIds) {
      const result = new Map<string, BenchmarkCurve>();
      if (benchmarkIds.length === 0) return result;

      const ids = [...new Set(benchmarkIds)];

      const benches = await db
        .select({ id: benchmarkRate.id, name: benchmarkRate.name })
        .from(benchmarkRate)
        .where(inArray(benchmarkRate.id, ids));

      for (const bench of benches) {
        result.set(bench.id, { name: bench.name, points: [] });
      }

      if (result.size === 0) return result;

      const points = await db
        .select({
          benchmarkId: benchmarkRatePoint.benchmarkId,
          effectiveDate: benchmarkRatePoint.effectiveDate,
          rateBps: benchmarkRatePoint.rateBps,
        })
        .from(benchmarkRatePoint)
        .where(inArray(benchmarkRatePoint.benchmarkId, [...result.keys()]))
        .orderBy(
          asc(benchmarkRatePoint.benchmarkId),
          asc(benchmarkRatePoint.effectiveDate),
        );

      for (const point of points) {
        const curve = result.get(point.benchmarkId);
        if (!curve) continue;
        curve.points.push({
          effectiveDate: point.effectiveDate,
          rateBps: point.rateBps,
        });
      }

      return result;
    },
  };
}
