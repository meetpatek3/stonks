import { describe, expect, it } from "vitest";
import { ValidationError, type DayCount, type PostingDayRule } from "@stonks/ledger";
import type {
  CreateFacilityTermsInput,
  FacilityTermsRecord,
  FacilityTermsRepo,
  UpsertBenchmarkPointInput,
} from "@stonks/db";
import {
  createBenchmarkHandler,
  createFacilityTermsHandler,
  getFacilityTermsHandler,
  listBenchmarksHandler,
  upsertBenchmarkPointHandler,
} from "@/lib/facility-terms";

const session = { householdId: "hh-1" };

function makeFakeRepo(): FacilityTermsRepo & {
  terms: Map<string, FacilityTermsRecord & { id: string }>;
  points: Map<string, Array<{ effectiveDate: string; rateBps: number }>>;
} {
  const benchmarks = new Map<string, string>();
  const points = new Map<string, Array<{ effectiveDate: string; rateBps: number }>>();
  const terms = new Map<string, FacilityTermsRecord & { id: string }>();
  let counter = 0;

  const repo: FacilityTermsRepo & {
    terms: typeof terms;
    points: typeof points;
  } = {
    terms,
    points,
    async listEffectiveTerms() {
      return [];
    },
    async listBenchmarkCurves(ids) {
      const map = new Map();
      for (const id of ids) {
        const name = benchmarks.get(id);
        if (!name) continue;
        map.set(id, { name, points: points.get(id) ?? [] });
      }
      return map;
    },
    async listBenchmarks() {
      return [...benchmarks.entries()].map(([id, name]) => ({ id, name }));
    },
    async createBenchmark(input) {
      if (!input.name.trim()) {
        throw new ValidationError("Benchmark name must be non-empty", "BENCHMARK");
      }
      counter += 1;
      const id = `bench-${counter}`;
      benchmarks.set(id, input.name.trim());
      points.set(id, []);
      return { id, name: input.name.trim() };
    },
    async upsertBenchmarkPoint(benchmarkId, input: UpsertBenchmarkPointInput) {
      if (!benchmarks.has(benchmarkId)) {
        throw new ValidationError("Unknown benchmark", "BENCHMARK");
      }
      if (!Number.isInteger(input.rateBps)) {
        throw new ValidationError("rateBps must be an integer", "TERMS");
      }
      const list = points.get(benchmarkId) ?? [];
      const idx = list.findIndex((p) => p.effectiveDate === input.effectiveDate);
      if (idx >= 0) list[idx] = input;
      else list.push(input);
      points.set(benchmarkId, list);
    },
    async insertTerms(householdId, input: CreateFacilityTermsInput) {
      if (householdId !== "hh-1" || input.accountId === "cash-1") {
        throw new ValidationError(
          "Account must be a CREDIT_FACILITY in this household",
          "ACCOUNT",
        );
      }
      if (!benchmarks.has(input.benchmarkId)) {
        throw new ValidationError("Unknown benchmark", "BENCHMARK");
      }
      if (!Number.isInteger(input.spreadBps)) {
        throw new ValidationError("spreadBps must be an integer", "TERMS");
      }
      counter += 1;
      const record: FacilityTermsRecord & { id: string } = {
        id: `terms-${counter}`,
        terms: {
          facilityAccountId: input.accountId,
          spreadBps: input.spreadBps,
          dayCount: input.dayCount,
          postingDayRule: input.postingDayRule,
          capitalizeInterest: input.capitalizeInterest,
        },
        benchmarkId: input.benchmarkId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
      };
      terms.set(input.accountId, record);
      return record;
    },
    async getLatestTerms(householdId, accountId) {
      if (householdId !== "hh-1") return null;
      return terms.get(accountId) ?? null;
    },
  };
  return repo;
}

describe("facility terms API handlers", () => {
  it("rejects unauthenticated list", async () => {
    const result = await listBenchmarksHandler({
      session: null,
      repo: makeFakeRepo(),
    });
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("rejects non-integer spreadBps", async () => {
    const repo = makeFakeRepo();
    const bench = await repo.createBenchmark({ name: "Prime" });
    const result = await createFacilityTermsHandler(
      "fac-1",
      {
        benchmarkId: bench.id,
        spreadBps: 50.5,
        dayCount: "ACT_365" satisfies DayCount,
        postingDayRule: "MONTH_END" satisfies PostingDayRule,
        capitalizeInterest: true,
        effectiveFrom: "2024-01-01",
      },
      { session, repo },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/spreadBps/i);
    }
  });

  it("creates terms and returns latest with curve", async () => {
    const repo = makeFakeRepo();
    const bench = await repo.createBenchmark({ name: "Prime" });
    await repo.upsertBenchmarkPoint(bench.id, {
      effectiveDate: "2024-01-01",
      rateBps: 500,
    });

    const created = await createFacilityTermsHandler(
      "fac-1",
      {
        benchmarkId: bench.id,
        spreadBps: 50,
        dayCount: "ACT_365",
        postingDayRule: "MONTH_END",
        capitalizeInterest: true,
        effectiveFrom: "2024-01-01",
      },
      { session, repo },
    );
    expect(created.ok).toBe(true);

    const got = await getFacilityTermsHandler("fac-1", { session, repo });
    expect(got.ok).toBe(true);
    if (got.ok) {
      const body = got.body as {
        terms: { spreadBps: number } | null;
        benchmark: { points: Array<{ rateBps: number }> } | null;
      };
      expect(body.terms?.spreadBps).toBe(50);
      expect(body.benchmark?.points).toEqual([{ effectiveDate: "2024-01-01", rateBps: 500 }]);
    }
  });

  it("rejects invalid rate point body", async () => {
    const repo = makeFakeRepo();
    const bench = await repo.createBenchmark({ name: "Prime" });
    const result = await upsertBenchmarkPointHandler(
      bench.id,
      { effectiveDate: "2024-01-01", rateBps: 1.5 },
      { session, repo },
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "rateBps must be an integer",
    });
  });

  it("maps repo ValidationError on createBenchmark empty name", async () => {
    const result = await createBenchmarkHandler(
      { name: "   " },
      { session, repo: makeFakeRepo() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});
