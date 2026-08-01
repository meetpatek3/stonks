import { describe, it, expect } from "vitest";
import {
  qtyFromDecimalString,
  qtyToDecimalString,
  qtyAdd,
  qtySub,
  QUANTITY_SCALE,
} from "../src/index.js";

describe("Quantity", () => {
  it("uses scale 8", () => {
    expect(QUANTITY_SCALE).toBe(8);
  });

  it("parses decimal strings exactly", () => {
    const q = qtyFromDecimalString("1.5");
    expect(q.scaled).toBe(150000000n);
    expect(qtyToDecimalString(q)).toBe("1.50000000");
  });

  it("parses fractional share amounts", () => {
    const q = qtyFromDecimalString("0.00000001");
    expect(q.scaled).toBe(1n);
  });

  it("rejects excess precision", () => {
    expect(() => qtyFromDecimalString("1.000000001")).toThrow(/precision/i);
  });

  it("adds and subtracts", () => {
    const a = qtyFromDecimalString("1.25");
    const b = qtyFromDecimalString("0.75");
    expect(qtyToDecimalString(qtyAdd(a, b))).toBe("2.00000000");
    expect(qtyToDecimalString(qtySub(a, b))).toBe("0.50000000");
  });
});
