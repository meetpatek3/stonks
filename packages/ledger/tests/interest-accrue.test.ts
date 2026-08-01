import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  modelInterest,
  FACILITY_USES,
  sumSlices,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const accounts = new Map<string, Account>([
  ["facility", { id: "facility", type: "CREDIT_FACILITY", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
]);

const draw: Journal = {
  id: "draw",
  type: "TRANSFER",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money(CAD, -100000n) },
    { accountId: "investment", amount: money(CAD, 100000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money(CAD, 100000n) }],
};

describe("interest accrual", () => {
  it("matches hand-calc daily interest at 365 bps ACT/365", () => {
    // daily = floor(100000 * 365 / (10000 * 365)) = 10 minor
    const result = modelInterest({
      journals: [draw],
      accounts,
      terms: {
        facilityAccountId: "facility",
        spreadBps: 0,
        dayCount: "ACT_365",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: true,
      },
      benchmarkCurve: [{ effectiveDate: "2024-01-01", rateBps: 365 }],
      periodStart: "2024-01-01",
      periodEnd: "2024-01-11",
    });

    expect(result.days).toHaveLength(10);
    expect(result.days[0]?.interestTotalMinor).toBe(10n);
    expect(result.modelledTotalMinor).toBe(100n);
    expect(result.modelledByUse.INVESTMENT).toBe(100n);
  });

  it("allocates slice interest exactly to total each day", () => {
    const splitDraw: Journal = {
      ...draw,
      id: "split",
      facilityUses: [
        { use: "INVESTMENT", amount: money(CAD, 60000n) },
        { use: "PERSONAL", amount: money(CAD, 40000n) },
      ],
    };

    const result = modelInterest({
      journals: [splitDraw],
      accounts,
      terms: {
        facilityAccountId: "facility",
        spreadBps: 0,
        dayCount: "ACT_365",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: true,
      },
      benchmarkCurve: [{ effectiveDate: "2020-01-01", rateBps: 365 }],
      periodStart: "2024-01-01",
      periodEnd: "2024-01-02",
    });

    const day = result.days[0]!;
    expect(day.interestTotalMinor).toBe(10n);
    expect(day.interestByUse.INVESTMENT).toBe(6n);
    expect(day.interestByUse.PERSONAL).toBe(4n);
    let sliceSum = 0n;
    for (const use of FACILITY_USES) sliceSum += day.interestByUse[use] ?? 0n;
    expect(sliceSum).toBe(day.interestTotalMinor);
    expect(sumSlices(day.owedByUse)).toBe(100000n);
  });
});
