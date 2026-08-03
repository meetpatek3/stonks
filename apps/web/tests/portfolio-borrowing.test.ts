import { describe, expect, it } from "vitest";
import { money, type Journal } from "@stonks/ledger";
import {
  derivePortfolioSnapshot,
  type AccountMeta,
} from "@/lib/portfolio-derive";

/**
 * Borrowing & interest in the read model.
 *
 * Every expected value is hand-calculated from the journals and terms below.
 * Modelled interest is an estimate (benchmark + spread); actual interest is
 * what was posted. Where terms or a benchmark curve are missing, the derived
 * field is `null` with a stated reason — never `0`, never a substitute.
 *
 * Worked example (facility currency = CAD, reporting = CAD):
 *
 *   2024-01-01  draw 1,000.00, INVESTMENT use
 *   2024-01-10  INTEREST_CHARGED 0.90 posted (actual)
 *   terms: spread 0 bps, ACT/365, capitalize
 *   benchmark: 365 bps from 2024-01-01
 *
 *   Daily modelled = floor(100000 * 365 / (10000 * 365)) = 10 minor
 *   YTD period 2024-01-01 .. 2024-01-11 (half-open) = 10 days → modelled 100
 *   variance = 100 − 90 = 10
 */

const ACCOUNTS: AccountMeta[] = [
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2 },
  { id: "investment", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

const draw: Journal = {
  id: "draw",
  type: "TRANSFER",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money("CAD", -100_000n) },
    { accountId: "investment", amount: money("CAD", 100_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 100_000n) }],
};

const actualInterest: Journal = {
  id: "int-actual",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-01-10",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money("CAD", -90n) },
    { accountId: "world", amount: money("CAD", 90n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 90n) }],
};

const TERMS = {
  terms: {
    facilityAccountId: "facility",
    spreadBps: 0,
    dayCount: "ACT_365" as const,
    postingDayRule: "CALENDAR_DAY" as const,
    capitalizeInterest: true,
  },
  benchmarkCurve: [{ effectiveDate: "2024-01-01", rateBps: 365 }],
};

describe("borrowing summary", () => {
  it("derives outstanding, use slices, YTD actual, effective rate, and modelled variance", () => {
    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [draw, actualInterest],
      facilityTerms: [TERMS],
      asOf: "2024-01-10",
    });

    const borrowing = snapshot.borrowing;
    expect(borrowing).not.toBeNull();
    expect(borrowing!.facilities).toHaveLength(1);

    const facility = borrowing!.facilities[0]!;
    // Outstanding owed = 100000 + 90 capitalized = 100090
    expect(facility.outstandingMinor).toBe("100090");
    expect(facility.useBreakdown.find((u) => u.use === "INVESTMENT")?.owedMinor).toBe(
      "100090",
    );
    expect(facility.investmentShareBps).toBe(10_000);
    expect(facility.effectiveRateBps).toBe(365);

    // YTD = calendar year of asOf, half-open [2024-01-01, 2024-01-11)
    expect(facility.interestChargedYtdMinor).toBe("90");
    expect(facility.investmentInterestYtdMinor).toBe("90");

    expect(facility.variance).not.toBeNull();
    expect(facility.variance!.modelledIsEstimate).toBe(true);
    expect(facility.variance!.modelledTotalMinor).toBe("100");
    expect(facility.variance!.actualPostedMinor).toBe("90");
    expect(facility.variance!.varianceMinor).toBe("10");
    expect(facility.variance!.periodStart).toBe("2024-01-01");
    expect(facility.variance!.periodEnd).toBe("2024-01-11");

    // Household KPIs
    expect(borrowing!.outstandingMinor).toBe("100090");
    expect(borrowing!.effectiveRateBps).toBe(365);
    expect(borrowing!.interestChargedYtdMinor).toBe("90");
    expect(borrowing!.investmentShareBps).toBe(10_000);
  });

  it("leaves modelled figures null with a reason when facility terms are absent", () => {
    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [draw, actualInterest],
      asOf: "2024-01-10",
    });

    const facility = snapshot.borrowing!.facilities[0]!;
    expect(facility.outstandingMinor).toBe("100090");
    expect(facility.interestChargedYtdMinor).toBe("90");
    expect(facility.effectiveRateBps).toBeNull();
    expect(facility.variance).toBeNull();
    const jan = facility.interestOverTime.find((p) => p.month === "2024-01");
    expect(jan).toBeDefined();
    expect(jan!.modelledMinor).toBeNull();
    expect(jan!.modelledIsEstimate).toBe(true);
    expect(jan!.actualMinor).toBe("90");
    expect(facility.uncertaintyReasons.some((r) => /terms/i.test(r))).toBe(true);
    expect(snapshot.borrowing!.effectiveRateBps).toBeNull();
  });

  it("leaves modelled figures null when the benchmark curve has no rate on asOf", () => {
    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [draw],
      facilityTerms: [
        {
          terms: TERMS.terms,
          // Curve starts after the period — rateBpsOnDate would throw.
          benchmarkCurve: [{ effectiveDate: "2025-01-01", rateBps: 400 }],
        },
      ],
      asOf: "2024-01-10",
    });

    const facility = snapshot.borrowing!.facilities[0]!;
    expect(facility.effectiveRateBps).toBeNull();
    expect(facility.variance).toBeNull();
    expect(facility.uncertaintyReasons.some((r) => /benchmark/i.test(r))).toBe(
      true,
    );
  });

  it("returns an empty facilities list when the household has no credit facilities", () => {
    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS.filter((a) => a.type !== "CREDIT_FACILITY"),
      journals: [],
    });

    expect(snapshot.borrowing).not.toBeNull();
    expect(snapshot.borrowing!.facilities).toEqual([]);
    expect(snapshot.borrowing!.outstandingMinor).toBe("0");
    expect(snapshot.borrowing!.interestChargedYtdMinor).toBe("0");
    expect(snapshot.borrowing!.investmentShareBps).toBeNull();
    expect(snapshot.borrowing!.effectiveRateBps).toBeNull();
  });

  it("splits use slices across INVESTMENT and PERSONAL and reports the investment share", () => {
    const splitDraw: Journal = {
      ...draw,
      id: "split",
      facilityUses: [
        { use: "INVESTMENT", amount: money("CAD", 60_000n) },
        { use: "PERSONAL", amount: money("CAD", 40_000n) },
      ],
    };

    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [splitDraw],
      asOf: "2024-01-01",
    });

    const facility = snapshot.borrowing!.facilities[0]!;
    expect(facility.outstandingMinor).toBe("100000");
    expect(facility.useBreakdown.find((u) => u.use === "INVESTMENT")?.owedMinor).toBe(
      "60000",
    );
    expect(facility.useBreakdown.find((u) => u.use === "PERSONAL")?.owedMinor).toBe(
      "40000",
    );
    // 60000/100000 = 6000 bps
    expect(facility.investmentShareBps).toBe(6_000);
    expect(snapshot.borrowing!.investmentShareBps).toBe(6_000);
  });

  it("builds monthly interest-over-time with modelled flagged as estimate and actual from postings", () => {
    const snapshot = derivePortfolioSnapshot({
      reportingCurrency: "CAD",
      reportingMinorUnits: 2,
      accounts: ACCOUNTS,
      journals: [draw, actualInterest],
      facilityTerms: [TERMS],
      asOf: "2024-01-10",
    });

    const points = snapshot.borrowing!.facilities[0]!.interestOverTime;
    expect(points.length).toBeGreaterThan(0);
    const jan = points.find((p) => p.month === "2024-01");
    expect(jan).toBeDefined();
    expect(jan!.modelledMinor).toBe("100");
    expect(jan!.modelledIsEstimate).toBe(true);
    expect(jan!.actualMinor).toBe("90");
  });
});
