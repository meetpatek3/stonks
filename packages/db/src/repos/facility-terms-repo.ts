import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  ValidationError,
  type BenchmarkRatePoint,
  type DayCount,
  type FacilityTerms,
  type PostingDayRule,
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

export type CreateBenchmarkInput = { name: string };

export type UpsertBenchmarkPointInput = {
  effectiveDate: string;
  rateBps: number;
};

export type CreateFacilityTermsInput = {
  accountId: string;
  benchmarkId: string;
  spreadBps: number;
  dayCount: DayCount;
  postingDayRule: PostingDayRule;
  capitalizeInterest: boolean;
  effectiveFrom: string;
};

/** YYYY-MM-DD → previous calendar day (UTC date parts only). */
export function isoDateMinusOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function toRecord(row: {
  accountId: string;
  benchmarkId: string;
  spreadBps: number;
  dayCount: string;
  postingDayRule: string;
  capitalizeInterest: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}): FacilityTermsRecord {
  return {
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
  };
}

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

  listBenchmarks(): Promise<Array<{ id: string; name: string }>>;

  createBenchmark(
    input: CreateBenchmarkInput,
  ): Promise<{ id: string; name: string }>;

  upsertBenchmarkPoint(
    benchmarkId: string,
    input: UpsertBenchmarkPointInput,
  ): Promise<void>;

  /**
   * Insert terms for a CREDIT_FACILITY in `householdId`.
   * Closes any open prior row for that account (effective_to = day before
   * effectiveFrom). Rejects if account missing, wrong household, or not
   * CREDIT_FACILITY. Rejects unknown benchmarkId.
   */
  insertTerms(
    householdId: string,
    input: CreateFacilityTermsInput,
  ): Promise<FacilityTermsRecord>;

  /** Latest terms row for account (any effective window), or null. */
  getLatestTerms(
    householdId: string,
    accountId: string,
  ): Promise<(FacilityTermsRecord & { id: string }) | null>;
}

export function createFacilityTermsRepo(db: Db): FacilityTermsRepo {
  return {
    async listEffectiveTerms(householdId, asOf) {
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

      return rows.map(toRecord);
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

    async listBenchmarks() {
      return db
        .select({ id: benchmarkRate.id, name: benchmarkRate.name })
        .from(benchmarkRate)
        .orderBy(asc(benchmarkRate.name));
    },

    async createBenchmark(input) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new ValidationError("Benchmark name must be non-empty", "BENCHMARK");
      }
      const [row] = await db
        .insert(benchmarkRate)
        .values({ name })
        .returning({ id: benchmarkRate.id, name: benchmarkRate.name });
      return row!;
    },

    async upsertBenchmarkPoint(benchmarkId, input) {
      const [bench] = await db
        .select({ id: benchmarkRate.id })
        .from(benchmarkRate)
        .where(eq(benchmarkRate.id, benchmarkId))
        .limit(1);
      if (!bench) {
        throw new ValidationError("Unknown benchmark", "BENCHMARK");
      }
      if (!Number.isInteger(input.rateBps)) {
        throw new ValidationError("rateBps must be an integer", "TERMS");
      }
      await db
        .insert(benchmarkRatePoint)
        .values({
          benchmarkId,
          effectiveDate: input.effectiveDate,
          rateBps: input.rateBps,
        })
        .onConflictDoUpdate({
          target: [
            benchmarkRatePoint.benchmarkId,
            benchmarkRatePoint.effectiveDate,
          ],
          set: { rateBps: input.rateBps },
        });
    },

    async insertTerms(householdId, input) {
      const [acct] = await db
        .select({
          id: account.id,
          type: account.type,
        })
        .from(account)
        .where(
          and(eq(account.id, input.accountId), eq(account.householdId, householdId)),
        )
        .limit(1);

      if (!acct || acct.type !== "CREDIT_FACILITY") {
        throw new ValidationError(
          "Account must be a CREDIT_FACILITY in this household",
          "ACCOUNT",
        );
      }

      const [bench] = await db
        .select({ id: benchmarkRate.id })
        .from(benchmarkRate)
        .where(eq(benchmarkRate.id, input.benchmarkId))
        .limit(1);
      if (!bench) {
        throw new ValidationError("Unknown benchmark", "BENCHMARK");
      }

      if (!Number.isInteger(input.spreadBps)) {
        throw new ValidationError("spreadBps must be an integer", "TERMS");
      }

      const [priorOpen] = await db
        .select({
          id: creditFacilityTerms.id,
          effectiveFrom: creditFacilityTerms.effectiveFrom,
        })
        .from(creditFacilityTerms)
        .where(
          and(
            eq(creditFacilityTerms.accountId, input.accountId),
            isNull(creditFacilityTerms.effectiveTo),
          ),
        )
        .limit(1);

      if (priorOpen) {
        const closedTo = isoDateMinusOneDay(input.effectiveFrom);
        if (closedTo < priorOpen.effectiveFrom) {
          throw new ValidationError(
            "effectiveFrom overlaps prior terms",
            "TERMS",
          );
        }
        await db
          .update(creditFacilityTerms)
          .set({ effectiveTo: closedTo })
          .where(eq(creditFacilityTerms.id, priorOpen.id));
      }

      const [row] = await db
        .insert(creditFacilityTerms)
        .values({
          accountId: input.accountId,
          benchmarkId: input.benchmarkId,
          spreadBps: input.spreadBps,
          dayCount: input.dayCount,
          postingDayRule: input.postingDayRule,
          capitalizeInterest: input.capitalizeInterest,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
        })
        .returning({
          accountId: creditFacilityTerms.accountId,
          benchmarkId: creditFacilityTerms.benchmarkId,
          spreadBps: creditFacilityTerms.spreadBps,
          dayCount: creditFacilityTerms.dayCount,
          postingDayRule: creditFacilityTerms.postingDayRule,
          capitalizeInterest: creditFacilityTerms.capitalizeInterest,
          effectiveFrom: creditFacilityTerms.effectiveFrom,
          effectiveTo: creditFacilityTerms.effectiveTo,
        });

      return toRecord(row!);
    },

    async getLatestTerms(householdId, accountId) {
      const [row] = await db
        .select({
          id: creditFacilityTerms.id,
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
            eq(creditFacilityTerms.accountId, accountId),
          ),
        )
        .orderBy(desc(creditFacilityTerms.effectiveFrom))
        .limit(1);

      if (!row) return null;
      return { id: row.id, ...toRecord(row) };
    },
  };
}
