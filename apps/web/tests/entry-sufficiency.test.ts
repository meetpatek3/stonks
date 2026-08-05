import { describe, expect, it } from "vitest";
import {
  cashAvailableMinor,
  cashShortfallMinor,
  exceedsPositionQty,
} from "../lib/entry-sufficiency";

describe("entry sufficiency", () => {
  it("computes shortfall for a buy", () => {
    expect(cashAvailableMinor("50000")).toBe(50000n);
    expect(cashShortfallMinor(50000n, 80000n)).toBe(30000n);
    expect(cashShortfallMinor(50000n, 40000n)).toBe(0n);
  });

  it("detects oversell", () => {
    expect(exceedsPositionQty("10.00000000", "11")).toBe(true);
    expect(exceedsPositionQty("10.00000000", "10")).toBe(false);
    expect(exceedsPositionQty(undefined, "1")).toBe(true);
  });
});
