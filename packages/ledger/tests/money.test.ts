import { describe, it, expect } from "vitest";
import { CAD, USD, money, add, sub, neg, isZero, compare } from "../src/index.js";

describe("Money", () => {
  it("stores minor units as bigint", () => {
    const m = money(CAD, 1050n); // $10.50
    expect(m.minor).toBe(1050n);
    expect(m.currency).toBe("CAD");
  });

  it("adds same currency", () => {
    expect(add(money(CAD, 100n), money(CAD, 50n))).toEqual(money(CAD, 150n));
  });

  it("rejects cross-currency add", () => {
    expect(() => add(money(CAD, 100n), money(USD, 100n))).toThrow(/currency/i);
  });

  it("subtracts and negates", () => {
    expect(sub(money(CAD, 100n), money(CAD, 30n))).toEqual(money(CAD, 70n));
    expect(neg(money(CAD, 40n))).toEqual(money(CAD, -40n));
  });

  it("compares", () => {
    expect(compare(money(CAD, 1n), money(CAD, 2n))).toBe(-1);
    expect(isZero(money(CAD, 0n))).toBe(true);
  });

  it("does not accept number minors at the type level (runtime guard)", () => {
    // @ts-expect-error minor must be bigint
    expect(() => money(CAD, 10.5 as unknown as bigint)).toThrow();
  });
});
