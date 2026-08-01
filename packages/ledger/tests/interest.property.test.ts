import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  applyFacilityJournal,
  emptyFacilitySliceState,
  sumSlices,
  modelInterest,
  FACILITY_USES,
  CAD,
  money,
} from "../src/index.js";
import { facilityDrawRepayChainArb } from "../src/testing/arbitrary.js";
import type { Journal } from "../src/ledger/types.js";

describe("interest / use-slice properties", () => {
  it("slice sum equals facility owed after every journal", () => {
    fc.assert(
      fc.property(facilityDrawRepayChainArb, (chain) => {
        let state = emptyFacilitySliceState("facility");
        for (const journal of chain.journals) {
          state = applyFacilityJournal(state, journal, chain.accounts);
          const owed =
            state.facilityBalanceMinor < 0n ? -state.facilityBalanceMinor : 0n;
          expect(sumSlices(state.slices)).toBe(owed);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("daily slice interest sums to daily total; period sums days", () => {
    fc.assert(
      fc.property(facilityDrawRepayChainArb, (chain) => {
        const result = modelInterest({
          journals: chain.journals,
          accounts: chain.accounts,
          terms: {
            facilityAccountId: "facility",
            spreadBps: 50,
            dayCount: "ACT_365",
            postingDayRule: "CALENDAR_DAY",
            capitalizeInterest: true,
          },
          benchmarkCurve: [{ effectiveDate: "2020-01-01", rateBps: 300 }],
          periodStart: "2024-01-01",
          periodEnd: "2024-01-08",
        });

        let daySum = 0n;
        for (const day of result.days) {
          let sliceInterest = 0n;
          for (const use of FACILITY_USES) {
            sliceInterest += day.interestByUse[use] ?? 0n;
          }
          expect(sliceInterest).toBe(day.interestTotalMinor);
          daySum += day.interestTotalMinor;
        }
        expect(result.modelledTotalMinor).toBe(daySum);
      }),
      { numRuns: 30 },
    );
  });

  it("slice mix does not change total modelled interest for same owed path", () => {
    const single: Journal = {
      id: "single",
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
    const split: Journal = {
      ...single,
      id: "split",
      facilityUses: [
        { use: "INVESTMENT", amount: money(CAD, 60000n) },
        { use: "PERSONAL", amount: money(CAD, 40000n) },
      ],
    };

    const accounts = new Map([
      ["facility", { id: "facility", type: "CREDIT_FACILITY" as const, currency: "CAD" }],
      ["investment", { id: "investment", type: "INVESTMENT" as const, currency: "CAD" }],
    ]);

    const terms = {
      facilityAccountId: "facility",
      spreadBps: 0,
      dayCount: "ACT_365" as const,
      postingDayRule: "CALENDAR_DAY" as const,
      capitalizeInterest: true,
    };
    const curve = [{ effectiveDate: "2024-01-01", rateBps: 365 }];

    const a = modelInterest({
      journals: [single],
      accounts,
      terms,
      benchmarkCurve: curve,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-11",
    });
    const b = modelInterest({
      journals: [split],
      accounts,
      terms,
      benchmarkCurve: curve,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-11",
    });

    expect(a.modelledTotalMinor).toBe(b.modelledTotalMinor);
  });
});
