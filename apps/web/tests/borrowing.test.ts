import { describe, expect, it } from "vitest";
import {
  facilityUseLabel,
  toInterestChartRows,
  toUseBreakdownSlices,
} from "@/lib/borrowing";
import type { FacilityInterestPoint, FacilityUseRow } from "@/lib/portfolio-shared";

describe("facilityUseLabel", () => {
  it("names every facility use for display", () => {
    expect(facilityUseLabel("INVESTMENT")).toBe("Investment");
    expect(facilityUseLabel("LENDING")).toBe("Lending");
    expect(facilityUseLabel("PERSONAL")).toBe("Personal");
    expect(facilityUseLabel("OTHER")).toBe("Other");
  });
});

describe("toUseBreakdownSlices", () => {
  it("keeps only positive-owed uses and preserves minor-unit strings", () => {
    const rows: FacilityUseRow[] = [
      { use: "INVESTMENT", owedMinor: "60000", bps: 6000 },
      { use: "LENDING", owedMinor: "0", bps: 0 },
      { use: "PERSONAL", owedMinor: "40000", bps: 4000 },
      { use: "OTHER", owedMinor: "0", bps: 0 },
    ];

    expect(toUseBreakdownSlices(rows)).toEqual([
      {
        key: "INVESTMENT",
        label: "Investment",
        owedMinor: "60000",
        bps: 6000,
        token: "var(--chart-1)",
      },
      {
        key: "PERSONAL",
        label: "Personal",
        owedMinor: "40000",
        bps: 4000,
        token: "var(--chart-3)",
      },
    ]);
  });

  it("returns an empty list when every use is zero", () => {
    const rows: FacilityUseRow[] = [
      { use: "INVESTMENT", owedMinor: "0", bps: null },
      { use: "LENDING", owedMinor: "0", bps: null },
      { use: "PERSONAL", owedMinor: "0", bps: null },
      { use: "OTHER", owedMinor: "0", bps: null },
    ];
    expect(toUseBreakdownSlices(rows)).toEqual([]);
  });
});

describe("toInterestChartRows", () => {
  it("converts minor units via the formatting boundary and omits modelled when null", () => {
    const points: FacilityInterestPoint[] = [
      {
        month: "2024-01",
        modelledMinor: "100",
        modelledIsEstimate: true,
        actualMinor: "90",
      },
      {
        month: "2024-02",
        modelledMinor: null,
        modelledIsEstimate: true,
        actualMinor: "50",
      },
    ];

    const rows = toInterestChartRows(points, 2);
    expect(rows).toEqual([
      {
        month: "2024-01",
        actual: 0.9,
        actualMinor: "90",
        modelled: 1,
        modelledMinor: "100",
      },
      {
        month: "2024-02",
        actual: 0.5,
        actualMinor: "50",
      },
    ]);
    // No modelled key when the read model had none — never a plotted zero.
    expect("modelled" in rows[1]!).toBe(false);
  });
});
