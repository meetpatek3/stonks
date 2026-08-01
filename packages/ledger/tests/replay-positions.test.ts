import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  qtyToDecimalString,
  replay,
  positionKey,
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
        securityId: "AAPL",
      },
      { accountId: "cash", amount: money(CAD, -costMinor) },
    ],
  };
}

function sell(
  id: string,
  tradeDate: string,
  qty: string,
  proceedsMinor: bigint,
): Journal {
  return {
    id,
    type: "SELL",
    tradeDate,
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      {
        accountId: "investment",
        amount: money(CAD, -proceedsMinor),
        quantity: qtyFromDecimalString(`-${qty}`),
        securityId: "AAPL",
      },
      { accountId: "cash", amount: money(CAD, proceedsMinor) },
    ],
  };
}

describe("replay positions", () => {
  it("derives ACB positions and realized gains by default", () => {
    const state = replay(
      [
        buy("j-buy-1", "2024-01-10", "100", 100000n),
        buy("j-buy-2", "2024-02-10", "100", 120000n),
        sell("j-sell", "2024-03-10", "100", 150000n),
      ],
      accounts,
      "CAD",
    );

    const key = positionKey("investment", "AAPL");
    expect(qtyToDecimalString(state.positions.get(key)!.quantity)).toBe(
      "100.00000000",
    );
    expect(state.positions.get(key)!.acbCostReportingMinor).toBe(110000n);
    expect(state.realized[0]?.gainReportingMinor).toBe(40000n);
    expect(state.quantities.get(key)?.scaled).toBe(
      state.positions.get(key)!.quantity.scaled,
    );
  });

  it("supports FIFO via replay options", () => {
    const state = replay(
      [
        buy("j-buy-1", "2024-01-10", "100", 100000n),
        buy("j-buy-2", "2024-02-10", "100", 120000n),
        sell("j-sell", "2024-03-10", "100", 150000n),
      ],
      accounts,
      "CAD",
      { costBasisMethod: "FIFO" },
    );

    expect(state.realized[0]?.gainReportingMinor).toBe(50000n);
    expect(state.positions.get(positionKey("investment", "AAPL"))!.lots).toHaveLength(
      1,
    );
  });
});
