import type { AccountId, FacilityUse } from "../ledger/types.js";

export type DayCount = "ACT_365" | "ACT_360" | "ACT_ACT";

export type PostingDayRule = "CALENDAR_DAY" | "MONTH_END";

export type UseSliceBalances = Partial<Record<FacilityUse, bigint>>;

export type BenchmarkRatePoint = {
  effectiveDate: string;
  rateBps: number;
};

export type FacilityTerms = {
  facilityAccountId: AccountId;
  spreadBps: number;
  dayCount: DayCount;
  postingDayRule: PostingDayRule;
  capitalizeInterest: boolean;
};

export type InterestDaySlice = {
  date: string;
  owedByUse: UseSliceBalances;
  interestByUse: UseSliceBalances;
  interestTotalMinor: bigint;
  annualRateBps: number;
};

export type InterestModelResult = {
  facilityAccountId: AccountId;
  periodStart: string;
  periodEnd: string;
  modelledByUse: UseSliceBalances;
  modelledTotalMinor: bigint;
  days: InterestDaySlice[];
  suggestedPostDate: string;
};

export type InterestVariance = {
  facilityAccountId: AccountId;
  periodStart: string;
  periodEnd: string;
  modelledTotalMinor: bigint;
  modelledByUse: UseSliceBalances;
  actualPostedMinor: bigint;
  varianceMinor: bigint;
  actualJournalIds: string[];
};

export const FACILITY_USES: readonly FacilityUse[] = [
  "INVESTMENT",
  "LENDING",
  "PERSONAL",
  "OTHER",
] as const;
