import { describe, expect, it } from "vitest";
import { decimalStringToMinor } from "@/lib/market/decimal";

describe("decimalStringToMinor", () => {
  it("converts a plain two-decimal price at scale 2", () => {
    expect(decimalStringToMinor("123.45", 2)).toBe(12345n);
  });

  it("pads a price with fewer decimals than the currency scale", () => {
    expect(decimalStringToMinor("7.5", 2)).toBe(750n);
    expect(decimalStringToMinor("7", 2)).toBe(700n);
    expect(decimalStringToMinor(".5", 2)).toBe(50n);
  });

  it("rounds half away from zero when the price has more decimals than the scale", () => {
    expect(decimalStringToMinor("1.005", 2)).toBe(101n);
    expect(decimalStringToMinor("1.004", 2)).toBe(100n);
    expect(decimalStringToMinor("1.006", 2)).toBe(101n);
    expect(decimalStringToMinor("-1.005", 2)).toBe(-101n);
    expect(decimalStringToMinor("-1.004", 2)).toBe(-100n);
  });

  it("rounds using only the first dropped digit's full remainder, not digit-by-digit", () => {
    // 1.0049999 must round DOWN to 1.00, not up via 1.005.
    expect(decimalStringToMinor("1.0049999", 2)).toBe(100n);
  });

  it("handles a zero-minor-unit currency", () => {
    expect(decimalStringToMinor("1234.6", 0)).toBe(1235n);
    expect(decimalStringToMinor("1234.4", 0)).toBe(1234n);
  });

  it("keeps full precision for values a double would corrupt", () => {
    // 9007199254740993 > Number.MAX_SAFE_INTEGER; Number("...") loses the last digit.
    expect(decimalStringToMinor("9007199254740993.01", 2)).toBe(900719925474099301n);
    expect(decimalStringToMinor("90071992547409931234.99", 2)).toBe(
      9007199254740993123499n,
    );
  });

  it("does not lose precision on a long fractional tail", () => {
    expect(decimalStringToMinor("1.23456789012345678", 8)).toBe(123456789n);
  });

  it("normalises a signed zero to 0n", () => {
    expect(decimalStringToMinor("-0.001", 2)).toBe(0n);
    expect(decimalStringToMinor("-0.00", 2)).toBe(0n);
  });

  it("accepts surrounding whitespace and a leading plus", () => {
    expect(decimalStringToMinor("  12.50 ", 2)).toBe(1250n);
    expect(decimalStringToMinor("+12.50", 2)).toBe(1250n);
  });

  it("returns null for anything that is not a plain decimal string", () => {
    for (const bad of ["", " ", "abc", "1.2.3", "1e5", "1,234.00", "--1", "1.", "NaN", "-"]) {
      expect(decimalStringToMinor(bad, 2), bad).toBeNull();
    }
  });

  it("returns null for an invalid scale", () => {
    expect(decimalStringToMinor("1.00", -1)).toBeNull();
    expect(decimalStringToMinor("1.00", 1.5)).toBeNull();
  });
});
