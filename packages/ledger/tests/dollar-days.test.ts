import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  replay,
  positionKey,
  attributeInvestmentInterest,
  allocateExact,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const accounts = new Map<string, Account>([
  ["ext", { id: "ext", type: "EXTERNAL", currency: "CAD" }],
  ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
]);

function buy(
  id: string,
  tradeDate: string,
  securityId: string,
  qty: string,
  costMinor: bigint,
): Journal {
  return {
    id,
    type: "BUY",
    tradeDate,
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      {
        accountId: "investment",
        amount: money(CAD, costMinor),
        quantity: qtyFromDecimalString(qty),
        securityId,
      },
      { accountId: "cash", amount: money(CAD, -costMinor) },
    ],
  };
}

describe("attributeInvestmentInterest", () => {
  it("allocates investment interest by dollar-days reporting cost", () => {
    const journals = [
      buy("j1", "2024-01-01", "AAPL", "10", 100000n),
      buy("j2", "2024-01-01", "MSFT", "10", 50000n),
    ];

    const { allocations, unallocatedMinor } = attributeInvestmentInterest({
      journals,
      accounts,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-04",
      investmentInterestMinor: 300n,
    });

    expect(allocations).toHaveLength(2);
    const aapl = allocations.find((a) => a.securityId === "AAPL")!;
    const msft = allocations.find((a) => a.securityId === "MSFT")!;
    expect(aapl.dollarDaysReporting).toBe(300000n);
    expect(msft.dollarDaysReporting).toBe(150000n);
    expect(aapl.interestMinor + msft.interestMinor).toBe(300n);
    expect(aapl.interestMinor).toBe(200n);
    expect(msft.interestMinor).toBe(100n);
    expect(unallocatedMinor).toBe(0n);
  });

  it("puts all interest in unallocated when no dollar-days", () => {
    const { allocations, unallocatedMinor } = attributeInvestmentInterest({
      journals: [],
      accounts,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-31",
      investmentInterestMinor: 500n,
    });

    expect(allocations).toHaveLength(0);
    expect(unallocatedMinor).toBe(500n);
  });

  it("uses closing cost after mid-period buy", () => {
    const journals = [
      buy("j1", "2024-01-01", "AAPL", "10", 100000n),
      buy("j2", "2024-01-03", "AAPL", "10", 100000n),
    ];

    const { allocations } = attributeInvestmentInterest({
      journals,
      accounts,
      periodStart: "2024-01-01",
      periodEnd: "2024-01-05",
      investmentInterestMinor: 1000n,
    });

    expect(allocations).toHaveLength(1);
    // Day 1-2: 100000 each; Day 3-4: 200000 each = 600000 total
    expect(allocations[0]!.dollarDaysReporting).toBe(600000n);
  });

  it("allocation parts sum to total interest exactly", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.array(fc.bigInt({ min: 1n, max: 1_000_000n }), {
          minLength: 1,
          maxLength: 8,
        }),
        (total, weights) => {
          const parts = allocateExact(total, weights);
          expect(parts.reduce((s, p) => s + p, 0n)).toBe(total);
        },
      ),
      { numRuns: 100 },
    );
  });
});
