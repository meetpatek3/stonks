import { describe, it, expect } from "vitest";
import { mulDivFloor, allocateCost } from "../src/index.js";

describe("mulDivFloor", () => {
  it("multiplies then divides with floor", () => {
    expect(mulDivFloor(10n, 3n, 2n)).toBe(15n);
    expect(mulDivFloor(100n, 1n, 3n)).toBe(33n);
  });

  it("rejects non-positive divisor", () => {
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow(/divisor/i);
  });
});

describe("allocateCost", () => {
  it("floors partial allocation", () => {
    expect(allocateCost(1000n, 1n, 3n)).toBe(333n);
  });

  it("returns full total when take equals whole", () => {
    expect(allocateCost(1000n, 3n, 3n)).toBe(1000n);
    expect(allocateCost(100n, 3n, 3n)).toBe(100n);
  });

  it("rejects take > whole", () => {
    expect(() => allocateCost(100n, 4n, 3n)).toThrow(/take/i);
  });
});
