import { describe, expect, it } from "vitest";
import {
  groupOpenItemsBySeverity,
  openItemRefHref,
  openItemRowId,
  openItemSeverityTone,
} from "@/lib/open-items-table";
import type { OpenItem } from "@/lib/portfolio-shared";

/**
 * Pure helpers for the open-items dashboard. Grouping, tones, and hrefs are
 * presentation decisions over figures the read model already produced —
 * nothing here counts or invents a finding.
 */

function item(overrides: Partial<OpenItem> = {}): OpenItem {
  return {
    kind: "UNKNOWN_COST_BASIS",
    severity: "WARNING",
    message: "No cost basis recorded for XEQT.",
    refType: "POSITION",
    refId: "brokerage:XEQT",
    ...overrides,
  };
}

describe("groupOpenItemsBySeverity", () => {
  it("orders ERROR before WARNING before INFO, dropping empty groups", () => {
    const grouped = groupOpenItemsBySeverity([
      item({
        kind: "ZERO_COST_BASIS",
        severity: "INFO",
        refId: "brokerage:GIFT",
      }),
      item({
        kind: "MISSING_FX_RATE",
        severity: "WARNING",
        refType: "ACCOUNT",
        refId: "usd-cash",
      }),
      item({
        kind: "UNKNOWN_COST_BASIS",
        severity: "ERROR",
        refId: "brokerage:AAPL",
        message: "Fabricated ERROR for ordering — severity is the sort key.",
      }),
    ]);

    expect(grouped.map((g) => g.severity)).toEqual([
      "ERROR",
      "WARNING",
      "INFO",
    ]);
    expect(grouped[0]?.items).toHaveLength(1);
    expect(grouped[0]?.items[0]?.refId).toBe("brokerage:AAPL");
    expect(grouped[1]?.items[0]?.refId).toBe("usd-cash");
    expect(grouped[2]?.items[0]?.refId).toBe("brokerage:GIFT");
  });

  it("omits a severity that has no items", () => {
    const grouped = groupOpenItemsBySeverity([
      item({ severity: "INFO", kind: "ZERO_COST_BASIS" }),
    ]);
    expect(grouped.map((g) => g.severity)).toEqual(["INFO"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupOpenItemsBySeverity([])).toEqual([]);
  });

  it("preserves relative order within a severity", () => {
    const grouped = groupOpenItemsBySeverity([
      item({ refId: "a", severity: "WARNING" }),
      item({
        refId: "b",
        severity: "WARNING",
        kind: "MISSING_FX_RATE",
        refType: "ACCOUNT",
      }),
    ]);
    expect(grouped[0]?.items.map((i) => i.refId)).toEqual(["a", "b"]);
  });
});

describe("openItemRefHref", () => {
  it("traces a POSITION finding to the positions screen", () => {
    expect(openItemRefHref("POSITION", "brokerage:XEQT")).toBe("/positions");
  });

  it("traces an ACCOUNT finding to the accounts screen", () => {
    expect(openItemRefHref("ACCOUNT", "usd-cash")).toBe("/accounts");
  });

  it("traces a JOURNAL finding to the ledger screen", () => {
    expect(openItemRefHref("JOURNAL", "j-sell-1")).toBe("/ledger");
  });
});

describe("openItemSeverityTone", () => {
  it("maps severities onto HeroUI chip colour tokens", () => {
    expect(openItemSeverityTone("ERROR")).toBe("danger");
    expect(openItemSeverityTone("WARNING")).toBe("warning");
    expect(openItemSeverityTone("INFO")).toBe("accent");
  });
});

describe("openItemRowId", () => {
  it("builds a stable unique key from kind, ref type, and ref id", () => {
    expect(
      openItemRowId(
        item({
          kind: "MISSING_FX_RATE",
          refType: "ACCOUNT",
          refId: "usd-cash",
        }),
      ),
    ).toBe("MISSING_FX_RATE:ACCOUNT:usd-cash");
  });
});
