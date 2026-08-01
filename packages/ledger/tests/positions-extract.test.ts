import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  extractSecurityLegs,
  ValidationError,
} from "../src/index.js";

describe("extractSecurityLegs", () => {
  it("defaults trade fields to reporting when omitted", () => {
    const legs = extractSecurityLegs([
      {
        accountId: "inv",
        amount: money(CAD, 1000n),
        quantity: qtyFromDecimalString("10"),
        securityId: "AAPL",
      },
      { accountId: "cash", amount: money(CAD, -1000n) },
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      tradeCurrency: "CAD",
      tradeAmountMinor: 1000n,
      reportingAmountMinor: 1000n,
    });
  });

  it("keeps explicit trade currency amounts", () => {
    const legs = extractSecurityLegs([
      {
        accountId: "inv",
        amount: money(CAD, 13500n),
        quantity: qtyFromDecimalString("10"),
        securityId: "AAPL",
        tradeCurrency: "USD",
        tradeAmountMinor: 10000n,
      },
    ]);
    expect(legs[0]?.tradeCurrency).toBe("USD");
    expect(legs[0]?.tradeAmountMinor).toBe(10000n);
    expect(legs[0]?.reportingAmountMinor).toBe(13500n);
  });

  it("rejects partial trade fields", () => {
    expect(() =>
      extractSecurityLegs([
        {
          accountId: "inv",
          amount: money(CAD, 1000n),
          quantity: qtyFromDecimalString("1"),
          securityId: "X",
          tradeCurrency: "USD",
        },
      ]),
    ).toThrow(ValidationError);
  });
});
