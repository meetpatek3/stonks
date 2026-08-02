import { describe, expect, it } from "vitest";
import {
  formatBps,
  formatMoney,
  formatQuantity,
  formatUncertain,
  minorToDisplayNumber,
  signedTrend,
  UNKNOWN,
} from "@/lib/format";

describe("formatMoney", () => {
  it("formats a positive CAD value with thousands grouping", () => {
    expect(formatMoney("123456789", "CAD", 2)).toBe("$1,234,567.89");
  });

  it("formats a negative value with a leading minus", () => {
    expect(formatMoney("-500", "CAD", 2)).toBe("-$5.00");
  });

  it("formats a zero-minor-unit currency (JPY) without a decimal point", () => {
    expect(formatMoney("1500", "JPY", 0)).toBe("JP¥1,500");
  });

  it("formats a value smaller than one major unit", () => {
    expect(formatMoney("5", "USD", 2)).toBe("US$0.05");
  });
});

describe("minorToDisplayNumber", () => {
  it("converts minor units to a display number", () => {
    expect(minorToDisplayNumber("123456", 2)).toBeCloseTo(1234.56);
  });

  it("converts a negative minor value", () => {
    expect(minorToDisplayNumber("-500", 2)).toBeCloseTo(-5);
  });

  it("handles zero minor units (e.g. JPY)", () => {
    expect(minorToDisplayNumber("1500", 0)).toBe(1500);
  });

  it("handles a zero value", () => {
    expect(minorToDisplayNumber("0", 2)).toBe(0);
  });
});

describe("formatQuantity", () => {
  it("trims trailing zeros to a whole number", () => {
    expect(formatQuantity("420.00000000")).toBe("420");
  });

  it("trims trailing zeros to a fraction", () => {
    expect(formatQuantity("0.50000000")).toBe("0.5");
  });

  it("keeps a non-trailing-zero fractional digit", () => {
    expect(formatQuantity("1000.00000001")).toBe("1000.00000001");
  });

  it("formats a negative quantity", () => {
    expect(formatQuantity("-42.50000000")).toBe("-42.5");
  });

  it("formats a whole-number string with no decimal point", () => {
    expect(formatQuantity("100")).toBe("100");
  });
});

describe("formatBps", () => {
  it("formats a positive bps value", () => {
    expect(formatBps(842)).toBe("8.42%");
  });

  it("formats a negative bps value", () => {
    expect(formatBps(-125)).toBe("-1.25%");
  });

  it("formats zero", () => {
    expect(formatBps(0)).toBe("0.00%");
  });
});

describe("signedTrend", () => {
  it("returns up for a positive minor value", () => {
    expect(signedTrend("100")).toBe("up");
  });

  it("returns down for a negative minor value", () => {
    expect(signedTrend("-100")).toBe("down");
  });

  it("returns neutral for a zero minor value", () => {
    expect(signedTrend("0")).toBe("neutral");
  });
});

describe("formatUncertain", () => {
  it("returns the UNKNOWN marker for undefined", () => {
    expect(formatUncertain(undefined)).toBe(UNKNOWN);
  });

  it("returns the UNKNOWN marker for null", () => {
    expect(formatUncertain(null)).toBe(UNKNOWN);
  });

  it("returns the formatted value when present", () => {
    expect(formatUncertain("$5.00")).toBe("$5.00");
  });

  it("UNKNOWN is a visible marker, not a bare dash or zero", () => {
    expect(UNKNOWN).not.toBe("0");
    expect(UNKNOWN).not.toBe("—");
    expect(UNKNOWN.length).toBeGreaterThan(0);
  });
});
