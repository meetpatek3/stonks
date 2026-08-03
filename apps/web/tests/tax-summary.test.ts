import { describe, expect, it } from "vitest";
import {
  parseTaxYearParam,
  taxYearChoices,
  taxYearsFromValueSeries,
} from "@/lib/tax-summary";

/**
 * Pure helpers for the tax screen. Every expectation is hand-calculated —
 * years are inclusive calendar bounds, never snapshotted from output.
 */

describe("parseTaxYearParam", () => {
  it("returns undefined when the param is absent or empty", () => {
    expect(parseTaxYearParam(undefined)).toBeUndefined();
    expect(parseTaxYearParam(null)).toBeUndefined();
    expect(parseTaxYearParam("")).toBeUndefined();
  });

  it("accepts a four-digit calendar year", () => {
    expect(parseTaxYearParam("2024")).toBe(2024);
  });

  it("takes the first value when Next.js hands an array", () => {
    expect(parseTaxYearParam(["2023", "2024"])).toBe(2023);
  });

  it("rejects anything that is not a four-digit year", () => {
    expect(parseTaxYearParam("24")).toBeUndefined();
    expect(parseTaxYearParam("2024-01")).toBeUndefined();
    expect(parseTaxYearParam("abcd")).toBeUndefined();
    expect(parseTaxYearParam("20240")).toBeUndefined();
  });
});

describe("taxYearChoices", () => {
  it("lists every year from first to last, inclusive", () => {
    // Ledger covering 2024 through 2026: three selectable years, including
    // the quiet middle year, so the user can see its genuine zeroes.
    expect(taxYearChoices(2024, 2026)).toEqual([2024, 2025, 2026]);
  });

  it("returns a single year when first equals last", () => {
    expect(taxYearChoices(2024, 2024)).toEqual([2024]);
  });

  it("returns an empty list when the range is inverted", () => {
    expect(taxYearChoices(2026, 2024)).toEqual([]);
  });
});

describe("taxYearsFromValueSeries", () => {
  it("spans the first and last month of the value-over-time series", () => {
    // Oldest-first series from deriveValueOverTime: Jan 2024 … Dec 2026.
    const years = taxYearsFromValueSeries([
      { month: "2024-01" },
      { month: "2024-06" },
      { month: "2025-12" },
      { month: "2026-03" },
    ]);
    expect(years).toEqual([2024, 2025, 2026]);
  });

  it("returns an empty list when there is no series", () => {
    expect(taxYearsFromValueSeries([])).toEqual([]);
  });
});
