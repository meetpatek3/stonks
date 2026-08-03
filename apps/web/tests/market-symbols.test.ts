import { describe, expect, it } from "vitest";
import { resolveSymbolAsOf, type SymbolRow } from "@/lib/market/symbols";

const row = (over: Partial<SymbolRow>): SymbolRow => ({
  securityId: "sec-1",
  symbol: "AAA",
  exchange: "TSX",
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  ...over,
});

describe("resolveSymbolAsOf", () => {
  it("returns null when there are no rows", () => {
    expect(resolveSymbolAsOf([], "2026-08-01")).toBeNull();
  });

  it("ignores rows that start after the requested date", () => {
    expect(resolveSymbolAsOf([row({ effectiveFrom: "2026-08-02" })], "2026-08-01")).toBeNull();
  });

  it("ignores rows that ended before the requested date", () => {
    expect(
      resolveSymbolAsOf([row({ effectiveTo: "2026-07-31" })], "2026-08-01"),
    ).toBeNull();
  });

  it("includes a row whose effective_to is the requested date itself", () => {
    expect(resolveSymbolAsOf([row({ effectiveTo: "2026-08-01" })], "2026-08-01")?.symbol).toBe(
      "AAA",
    );
  });

  it("takes the greatest effective_from at or before the date when ranges overlap", () => {
    const rows = [
      row({ symbol: "OLD", effectiveFrom: "2020-01-01", effectiveTo: null }),
      row({ symbol: "NEW", effectiveFrom: "2024-06-01", effectiveTo: null }),
    ];
    expect(resolveSymbolAsOf(rows, "2026-08-01")?.symbol).toBe("NEW");
    // Before the rename, the older symbol is still the right one.
    expect(resolveSymbolAsOf(rows, "2021-01-01")?.symbol).toBe("OLD");
  });

  it("is deterministic when two rows share the same effective_from", () => {
    const rows = [
      row({ symbol: "ZZZ", exchange: "NYSE", effectiveFrom: "2024-06-01" }),
      row({ symbol: "AAA", exchange: "TSX", effectiveFrom: "2024-06-01" }),
    ];
    const forward = resolveSymbolAsOf(rows, "2026-08-01");
    const reversed = resolveSymbolAsOf([...rows].reverse(), "2026-08-01");
    expect(forward).toEqual(reversed);
    expect(forward?.symbol).toBe("AAA");
  });
});
