import { describe, it, expect } from "vitest";
import { mulDivFloor, allocateExact } from "../src/index.js";

describe("mulDivFloor", () => {
  it("multiplies then divides with floor", () => {
    expect(mulDivFloor(100000n, 365n, 10_000n * 365n)).toBe(10n);
    expect(mulDivFloor(100n, 1n, 3n)).toBe(33n);
  });
});

describe("allocateExact", () => {
  it("parts sum to total", () => {
    const parts = allocateExact(10n, [60000n, 40000n, 0n, 0n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(10n);
    expect(parts[0]).toBe(6n);
    expect(parts[1]).toBe(4n);
  });

  it("distributes leftover by largest remainder", () => {
    const parts = allocateExact(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });

  it("rejects negative weights", () => {
    expect(() => allocateExact(10n, [-1n])).toThrow(/non-negative/i);
  });
});
