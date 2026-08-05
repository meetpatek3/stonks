import {
  ValidationError,
  type DayCount,
  type PostingDayRule,
} from "@stonks/ledger";
import type { FacilityTermsRepo } from "@stonks/db";

/**
 * Cookie-authenticated handlers for facility terms and benchmark writes.
 * All household-scoped mutations go through FacilityTermsRepo.
 */

export type FacilityTermsSession = { householdId: string };

export type FacilityTermsHandlerResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string };

const DAY_COUNTS = new Set<DayCount>(["ACT_365", "ACT_360", "ACT_ACT"]);
const POSTING_RULES = new Set<PostingDayRule>(["CALENDAR_DAY", "MONTH_END"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function unauthorized(): FacilityTermsHandlerResult {
  return { ok: false, status: 401, error: "Unauthorized" };
}

function mapValidation(error: unknown): FacilityTermsHandlerResult | null {
  if (error instanceof ValidationError) {
    return { ok: false, status: 400, error: error.message };
  }
  return null;
}

export async function listBenchmarksHandler(ctx: {
  session: FacilityTermsSession | null;
  repo: FacilityTermsRepo;
}): Promise<FacilityTermsHandlerResult> {
  if (!ctx.session) return unauthorized();
  const benchmarks = await ctx.repo.listBenchmarks();
  return { ok: true, status: 200, body: { benchmarks } };
}

export async function createBenchmarkHandler(
  body: unknown,
  ctx: { session: FacilityTermsSession | null; repo: FacilityTermsRepo },
): Promise<FacilityTermsHandlerResult> {
  if (!ctx.session) return unauthorized();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }
  const name = (body as { name?: unknown }).name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, status: 400, error: "name must be a non-empty string" };
  }
  try {
    const created = await ctx.repo.createBenchmark({ name });
    return { ok: true, status: 201, body: created };
  } catch (error) {
    const mapped = mapValidation(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function upsertBenchmarkPointHandler(
  benchmarkId: string,
  body: unknown,
  ctx: { session: FacilityTermsSession | null; repo: FacilityTermsRepo },
): Promise<FacilityTermsHandlerResult> {
  if (!ctx.session) return unauthorized();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.effectiveDate !== "string" ||
    !ISO_DATE.test(record.effectiveDate)
  ) {
    return {
      ok: false,
      status: 400,
      error: "effectiveDate must be an ISO date string (YYYY-MM-DD)",
    };
  }
  if (typeof record.rateBps !== "number" || !Number.isInteger(record.rateBps)) {
    return { ok: false, status: 400, error: "rateBps must be an integer" };
  }
  try {
    await ctx.repo.upsertBenchmarkPoint(benchmarkId, {
      effectiveDate: record.effectiveDate,
      rateBps: record.rateBps,
    });
    return { ok: true, status: 200, body: { ok: true } };
  } catch (error) {
    const mapped = mapValidation(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function getFacilityTermsHandler(
  accountId: string,
  ctx: { session: FacilityTermsSession | null; repo: FacilityTermsRepo },
): Promise<FacilityTermsHandlerResult> {
  if (!ctx.session) return unauthorized();
  const latest = await ctx.repo.getLatestTerms(ctx.session.householdId, accountId);
  if (!latest) {
    return { ok: true, status: 200, body: { terms: null } };
  }
  const curves = await ctx.repo.listBenchmarkCurves([latest.benchmarkId]);
  const curve = curves.get(latest.benchmarkId);
  return {
    ok: true,
    status: 200,
    body: {
      terms: {
        id: latest.id,
        accountId: latest.terms.facilityAccountId,
        benchmarkId: latest.benchmarkId,
        spreadBps: latest.terms.spreadBps,
        dayCount: latest.terms.dayCount,
        postingDayRule: latest.terms.postingDayRule,
        capitalizeInterest: latest.terms.capitalizeInterest,
        effectiveFrom: latest.effectiveFrom,
        effectiveTo: latest.effectiveTo,
      },
      benchmark: curve
        ? { id: latest.benchmarkId, name: curve.name, points: curve.points }
        : null,
    },
  };
}

export async function createFacilityTermsHandler(
  accountId: string,
  body: unknown,
  ctx: { session: FacilityTermsSession | null; repo: FacilityTermsRepo },
): Promise<FacilityTermsHandlerResult> {
  if (!ctx.session) return unauthorized();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.benchmarkId !== "string" || record.benchmarkId.length === 0) {
    return { ok: false, status: 400, error: "benchmarkId is required" };
  }
  if (typeof record.spreadBps !== "number" || !Number.isInteger(record.spreadBps)) {
    return { ok: false, status: 400, error: "spreadBps must be an integer" };
  }
  if (typeof record.dayCount !== "string" || !DAY_COUNTS.has(record.dayCount as DayCount)) {
    return { ok: false, status: 400, error: "dayCount is invalid" };
  }
  if (
    typeof record.postingDayRule !== "string" ||
    !POSTING_RULES.has(record.postingDayRule as PostingDayRule)
  ) {
    return { ok: false, status: 400, error: "postingDayRule is invalid" };
  }
  if (typeof record.capitalizeInterest !== "boolean") {
    return { ok: false, status: 400, error: "capitalizeInterest must be a boolean" };
  }
  if (
    typeof record.effectiveFrom !== "string" ||
    !ISO_DATE.test(record.effectiveFrom)
  ) {
    return {
      ok: false,
      status: 400,
      error: "effectiveFrom must be an ISO date string (YYYY-MM-DD)",
    };
  }

  try {
    const created = await ctx.repo.insertTerms(ctx.session.householdId, {
      accountId,
      benchmarkId: record.benchmarkId,
      spreadBps: record.spreadBps,
      dayCount: record.dayCount as DayCount,
      postingDayRule: record.postingDayRule as PostingDayRule,
      capitalizeInterest: record.capitalizeInterest,
      effectiveFrom: record.effectiveFrom,
    });
    return {
      ok: true,
      status: 201,
      body: {
        accountId: created.terms.facilityAccountId,
        benchmarkId: created.benchmarkId,
        spreadBps: created.terms.spreadBps,
        dayCount: created.terms.dayCount,
        postingDayRule: created.terms.postingDayRule,
        capitalizeInterest: created.terms.capitalizeInterest,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
      },
    };
  } catch (error) {
    const mapped = mapValidation(error);
    if (mapped) return mapped;
    throw error;
  }
}
