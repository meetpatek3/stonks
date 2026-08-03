import { describe, expect, it } from "vitest";
import {
  compareMinor,
  compareNullableNumber,
  compareQuantity,
  positionQualifiers,
  sharedUncertaintyReasons,
} from "@/lib/positions-table";
import type { PositionRow } from "@/lib/portfolio-shared";

/**
 * The positions grid's pure units: the comparators that order its rows and
 * the classifier that decides which qualifier labels a row carries. Every
 * expectation is stated directly, never snapshotted from output.
 */

/** A fully derivable row; each test overrides only the field it is about. */
function row(overrides: Partial<PositionRow> = {}): PositionRow {
  return {
    key: "brokerage:XEQT",
    accountId: "brokerage",
    securityId: "XEQT",
    symbol: "XEQT",
    quantity: "150.00000000",
    tradeCurrency: "CAD",
    costReportingMinor: "400000",
    costIsUnknown: false,
    realizedGainReportingMinor: "0",
    realizedGainUncertaintyReason: null,
    realizedSourceJournalIds: [],
    priceSource: "QUOTE",
    priceMinor: "3000",
    priceCurrency: "CAD",
    priceMinorUnits: 2,
    priceAsOf: "2024-03-31",
    priceIsStale: false,
    marketValueTradeMinor: "450000",
    marketValueMinor: "450000",
    unrealizedGainMinor: "50000",
    interestCostMinor: "10000",
    feeCostMinor: "0",
    grossReturnBps: 1250,
    netReturnBps: 1000,
    valuationIsUncertain: false,
    valuationUncertaintyReasons: [],
    ...overrides,
  };
}

describe("compareMinor", () => {
  it("orders by value, not by text", () => {
    // "9" sorts after "10" lexically; as money it comes first.
    expect(compareMinor("900", "1000")).toBeLessThan(0);
    expect(compareMinor("1000", "900")).toBeGreaterThan(0);
    expect(compareMinor("1000", "1000")).toBe(0);
  });

  it("orders a negative amount below a positive one", () => {
    expect(compareMinor("-5000", "100")).toBeLessThan(0);
  });

  it("keeps full precision beyond Number.MAX_SAFE_INTEGER", () => {
    // These two differ by one minor unit and are equal as IEEE doubles.
    const a = "9007199254740993";
    const b = "9007199254740992";
    expect(compareMinor(a, b)).toBeGreaterThan(0);
  });

  it("sorts an absent figure below every present one, including a loss", () => {
    expect(compareMinor(null, "-5000")).toBeLessThan(0);
    expect(compareMinor("-5000", null)).toBeGreaterThan(0);
    expect(compareMinor(null, null)).toBe(0);
  });

  it("sorts a whole column into ascending order with the gaps last", () => {
    const sorted = ["1000", null, "-200", "50"].sort(compareMinor);
    expect(sorted).toEqual([null, "-200", "50", "1000"]);
  });
});

describe("compareNullableNumber", () => {
  it("orders basis points numerically", () => {
    expect(compareNullableNumber(900, 1000)).toBeLessThan(0);
    expect(compareNullableNumber(-100, 0)).toBeLessThan(0);
    expect(compareNullableNumber(1250, 1250)).toBe(0);
  });

  it("sorts an absent return below a negative one", () => {
    expect(compareNullableNumber(null, -900)).toBeLessThan(0);
    expect(compareNullableNumber(-900, null)).toBeGreaterThan(0);
  });
});

describe("compareQuantity", () => {
  it("orders fixed-scale decimals by value", () => {
    expect(compareQuantity("9.00000000", "10.00000000")).toBeLessThan(0);
    expect(compareQuantity("150.00000000", "150.00000000")).toBe(0);
  });

  it("distinguishes quantities that differ only in the eighth decimal", () => {
    expect(compareQuantity("0.00000002", "0.00000001")).toBeGreaterThan(0);
  });

  it("orders a negative quantity below zero", () => {
    expect(compareQuantity("-1.00000000", "0.00000000")).toBeLessThan(0);
  });

  it("accepts a shorter fraction than the ledger's scale", () => {
    expect(compareQuantity("1.5", "1.50000000")).toBe(0);
    expect(compareQuantity("2", "1.99999999")).toBeGreaterThan(0);
  });
});

describe("sharedUncertaintyReasons", () => {
  const portfolioFee =
    "Fees of $50.00 name no holding, so they are excluded from this holding's net return and counted only across the portfolio.";

  it("lifts a reason every holding carries", () => {
    const rows = [
      row({ key: "a", symbol: "XEQT", valuationUncertaintyReasons: [portfolioFee] }),
      row({
        key: "b",
        symbol: "VFV",
        valuationUncertaintyReasons: [portfolioFee, "No cost basis is recorded for VFV."],
      }),
    ];
    expect(sharedUncertaintyReasons(rows)).toEqual([portfolioFee]);
  });

  it("leaves a reason only one holding carries alone", () => {
    const rows = [
      row({ key: "a", symbol: "XEQT", valuationUncertaintyReasons: [] }),
      row({ key: "b", symbol: "VFV", valuationUncertaintyReasons: [portfolioFee] }),
    ];
    expect(sharedUncertaintyReasons(rows)).toEqual([]);
  });

  it("lifts nothing from a single holding, which has no other row to share with", () => {
    const rows = [row({ valuationUncertaintyReasons: [portfolioFee] })];
    expect(sharedUncertaintyReasons(rows)).toEqual([]);
  });

  it("lifts nothing from an empty portfolio", () => {
    expect(sharedUncertaintyReasons([])).toEqual([]);
  });

  it("lifts a wholesale block while every row stays incomplete", () => {
    // A fee in a currency with no rate blocks feeCostMinor and netReturnBps on
    // *every* holding and raises the same reason on each. Lifting the reason
    // must not be read as the rows being whole: the screen's banner is built
    // from the rows themselves for exactly this case.
    const blocked =
      "j-fee: the fee is in USD and no rate is available to state it in CAD, so it cannot be counted as a cost.";
    const rows = [
      row({
        key: "a",
        symbol: "XEQT",
        feeCostMinor: null,
        netReturnBps: null,
        valuationUncertaintyReasons: [blocked],
      }),
      row({
        key: "b",
        symbol: "VFV",
        feeCostMinor: null,
        netReturnBps: null,
        valuationUncertaintyReasons: [blocked],
      }),
    ];

    expect(sharedUncertaintyReasons(rows)).toEqual([blocked]);
    for (const candidate of rows) {
      expect(positionQualifiers(candidate).isIncomplete).toBe(true);
    }
  });
});

describe("positionQualifiers", () => {
  it("qualifies a fully derived, currently-priced row with nothing", () => {
    expect(positionQualifiers(row())).toEqual({
      isStale: false,
      isIncomplete: false,
    });
  });

  it("calls a stale row stale, and not incomplete", () => {
    // A Friday close read on a Saturday is a real figure for an earlier date.
    const stale = row({ priceIsStale: true, priceAsOf: "2024-03-28" });
    expect(positionQualifiers(stale)).toEqual({
      isStale: true,
      isIncomplete: false,
    });
  });

  it("calls a row with an unknown cost basis incomplete", () => {
    const unknownCost = row({
      costIsUnknown: true,
      costReportingMinor: null,
      unrealizedGainMinor: null,
      grossReturnBps: null,
      netReturnBps: null,
    });
    expect(positionQualifiers(unknownCost)).toEqual({
      isStale: false,
      isIncomplete: true,
    });
  });

  it("calls a row incomplete when only its net return is missing", () => {
    // Interest charged with no facility-use attribution: gross survives.
    const noAttribution = row({ interestCostMinor: null, netReturnBps: null });
    expect(positionQualifiers(noAttribution).isIncomplete).toBe(true);
  });

  it("reports both when a stale row is also missing a figure", () => {
    const both = row({
      priceIsStale: true,
      priceAsOf: "2024-03-28",
      feeCostMinor: null,
      netReturnBps: null,
    });
    expect(positionQualifiers(both)).toEqual({
      isStale: true,
      isIncomplete: true,
    });
  });

  it("does not call a real zero a gap", () => {
    // No interest attributed and no fee charged are facts, not omissions.
    const zeroCosts = row({ interestCostMinor: "0", feeCostMinor: "0" });
    expect(positionQualifiers(zeroCosts).isIncomplete).toBe(false);
  });
});
