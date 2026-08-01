import { allocateExact, mulDivFloor } from "../money/rationals.js";
import type { Account, AccountId, Journal } from "../ledger/types.js";
import { addCalendarDays, dayCountDenominator } from "./day-count.js";
import {
  FACILITY_USES,
  type BenchmarkRatePoint,
  type FacilityTerms,
  type InterestDaySlice,
  type InterestModelResult,
  type UseSliceBalances,
} from "./types.js";
import { facilitySlicesAsOf, sumSlices } from "./use-slices.js";

export function rateBpsOnDate(
  curve: readonly BenchmarkRatePoint[],
  date: string,
): number {
  let best: BenchmarkRatePoint | undefined;
  for (const point of curve) {
    if (point.effectiveDate <= date) {
      if (best === undefined || point.effectiveDate > best.effectiveDate) {
        best = point;
      }
    }
  }
  if (best === undefined) {
    throw new Error(`No benchmark rate effective on or before ${date}`);
  }
  return best.rateBps;
}

function cloneOwed(slices: UseSliceBalances): UseSliceBalances {
  const next: UseSliceBalances = {};
  for (const use of FACILITY_USES) {
    const v = slices[use] ?? 0n;
    if (v !== 0n) next[use] = v;
  }
  return next;
}

function addToByUse(target: UseSliceBalances, add: UseSliceBalances): void {
  for (const use of FACILITY_USES) {
    const v = add[use] ?? 0n;
    if (v === 0n) continue;
    target[use] = (target[use] ?? 0n) + v;
  }
}

function lastDayOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  // day 0 of next month = last day of this month
  const d = new Date(Date.UTC(y, m, 0));
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

export function modelInterest(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<AccountId, Account>;
  terms: FacilityTerms;
  benchmarkCurve: readonly BenchmarkRatePoint[];
  periodStart: string;
  periodEnd: string;
}): InterestModelResult {
  const { journals, accounts, terms, benchmarkCurve, periodStart, periodEnd } =
    args;

  if (periodEnd <= periodStart) {
    throw new Error("periodEnd must be after periodStart");
  }

  const days: InterestDaySlice[] = [];
  const modelledByUse: UseSliceBalances = {};
  let modelledTotalMinor = 0n;

  // Exclude INTEREST_CHARGED from the model fold so actual charges don't feed back
  // into modelled accrual for the same period (actual wins on books only).
  const journalsForModel = journals.filter((j) => j.type !== "INTEREST_CHARGED");

  for (
    let date = periodStart;
    date < periodEnd;
    date = addCalendarDays(date, 1)
  ) {
    const state = facilitySlicesAsOf(
      journalsForModel,
      accounts,
      terms.facilityAccountId,
      date,
    );
    const owedByUse = cloneOwed(state.slices);
    const totalOwed = sumSlices(owedByUse);

    const benchmarkBps = rateBpsOnDate(benchmarkCurve, date);
    const annualRateBps = benchmarkBps + terms.spreadBps;
    if (annualRateBps < 0) {
      throw new Error(`Annual rate bps negative on ${date}: ${annualRateBps}`);
    }

    const denom = dayCountDenominator(terms.dayCount, date);
    const interestTotalMinor =
      totalOwed === 0n || annualRateBps === 0
        ? 0n
        : mulDivFloor(totalOwed, BigInt(annualRateBps), 10_000n * denom);

    const weights = FACILITY_USES.map((u) => owedByUse[u] ?? 0n);
    const parts =
      interestTotalMinor === 0n
        ? FACILITY_USES.map(() => 0n)
        : allocateExact(interestTotalMinor, weights);

    const interestByUse: UseSliceBalances = {};
    for (let i = 0; i < FACILITY_USES.length; i += 1) {
      const part = parts[i]!;
      if (part > 0n) interestByUse[FACILITY_USES[i]!] = part;
    }

    days.push({
      date,
      owedByUse,
      interestByUse,
      interestTotalMinor,
      annualRateBps,
    });

    modelledTotalMinor += interestTotalMinor;
    addToByUse(modelledByUse, interestByUse);
  }

  const lastAccrualDate = addCalendarDays(periodEnd, -1);
  const suggestedPostDate =
    terms.postingDayRule === "MONTH_END"
      ? lastDayOfMonth(lastAccrualDate)
      : lastAccrualDate;

  return {
    facilityAccountId: terms.facilityAccountId,
    periodStart,
    periodEnd,
    modelledByUse,
    modelledTotalMinor,
    days,
    suggestedPostDate,
  };
}
