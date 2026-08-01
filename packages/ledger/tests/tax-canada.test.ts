import { describe, it, expect } from "vitest";
import { summarizeCanadaTaxYear, CanadaJurisdiction } from "../src/tax/canada.js";

describe("summarizeCanadaTaxYear", () => {
  it("sums gains and losses and applies inclusion rate with floor", () => {
    const summary = summarizeCanadaTaxYear({
      year: 2024,
      realizedGains: [
        { gainReportingMinor: 10000n, tradeDate: "2024-03-01", journalId: "j-gain-1" },
        { gainReportingMinor: 5000n, tradeDate: "2024-06-01", journalId: "j-gain-2" },
        { gainReportingMinor: -3000n, tradeDate: "2024-09-01", journalId: "j-loss-1" },
      ],
      dividendIncomeMinor: 2000n,
      interestIncomeMinor: 500n,
      deductibleInvestmentInterestMinor: 1000n,
      inclusionRateBps: 5000,
    });

    expect(summary.jurisdiction).toBe("CA");
    expect(summary.year).toBe(2024);
    expect(summary.realizedGainsReportingMinor).toBe(15000n);
    expect(summary.realizedLossesReportingMinor).toBe(3000n);
    expect(summary.taxableCapitalGainsMinor).toBe(6000n);
    expect(summary.inclusionRateBps).toBe(5000);
    expect(summary.dividendIncomeMinor).toBe(2000n);
    expect(summary.interestIncomeMinor).toBe(500n);
    expect(summary.deductibleInterestExpenseMinor).toBe(1000n);
    expect(summary.flags).toEqual([]);
    expect(summary.disclaimer.toLowerCase()).toContain("not tax advice");
  });

  it("caps net gains at zero when losses exceed gains", () => {
    const summary = summarizeCanadaTaxYear({
      year: 2024,
      realizedGains: [
        { gainReportingMinor: 2000n, tradeDate: "2024-01-01", journalId: "j-gain" },
        { gainReportingMinor: -8000n, tradeDate: "2024-02-01", journalId: "j-loss" },
      ],
      dividendIncomeMinor: 0n,
      interestIncomeMinor: 0n,
      deductibleInvestmentInterestMinor: 0n,
    });

    expect(summary.realizedGainsReportingMinor).toBe(2000n);
    expect(summary.realizedLossesReportingMinor).toBe(8000n);
    expect(summary.taxableCapitalGainsMinor).toBe(0n);
  });

  it("uses default inclusion rate of 50% (5000 bps)", () => {
    const summary = summarizeCanadaTaxYear({
      year: 2024,
      realizedGains: [
        { gainReportingMinor: 10000n, tradeDate: "2024-01-01", journalId: "j-gain" },
      ],
      dividendIncomeMinor: 0n,
      interestIncomeMinor: 0n,
      deductibleInvestmentInterestMinor: 0n,
    });

    expect(summary.inclusionRateBps).toBe(5000);
    expect(summary.taxableCapitalGainsMinor).toBe(5000n);
  });

  it("floors taxable capital gains on fractional inclusion", () => {
    const summary = summarizeCanadaTaxYear({
      year: 2024,
      realizedGains: [
        { gainReportingMinor: 10001n, tradeDate: "2024-01-01", journalId: "j-gain" },
      ],
      dividendIncomeMinor: 0n,
      interestIncomeMinor: 0n,
      deductibleInvestmentInterestMinor: 0n,
      inclusionRateBps: 3333,
    });

    expect(summary.taxableCapitalGainsMinor).toBe(3333n);
  });

  it("adds superficial loss flags without adjusting gain numbers", () => {
    const summary = summarizeCanadaTaxYear({
      year: 2024,
      realizedGains: [
        { gainReportingMinor: -5000n, tradeDate: "2024-04-01", journalId: "j-sell" },
      ],
      dividendIncomeMinor: 0n,
      interestIncomeMinor: 0n,
      deductibleInvestmentInterestMinor: 0n,
      superficialLossCandidates: [
        { journalId: "j-sell", message: "Sold at loss within 30 days of repurchase" },
      ],
    });

    expect(summary.realizedLossesReportingMinor).toBe(5000n);
    expect(summary.taxableCapitalGainsMinor).toBe(0n);
    expect(summary.flags).toHaveLength(1);
    expect(summary.flags[0]).toEqual({
      code: "SUPERFICIAL_LOSS",
      message: "Sold at loss within 30 days of repurchase",
      journalIds: ["j-sell"],
    });
  });

  it("exposes CanadaJurisdiction module", () => {
    expect(CanadaJurisdiction.jurisdiction).toBe("CA");
    const summary = CanadaJurisdiction.summarizeYear({
      year: 2024,
      realizedGains: [],
      dividendIncomeMinor: 0n,
      interestIncomeMinor: 0n,
      deductibleInvestmentInterestMinor: 0n,
    });
    expect(summary.jurisdiction).toBe("CA");
  });
});
