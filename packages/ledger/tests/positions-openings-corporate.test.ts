import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  qtyToDecimalString,
  emptyPositionState,
  applyPositionsForJournal,
  positionKey,
} from "../src/index.js";
import type { Posting } from "../src/ledger/types.js";

function openingWithoutCost(
  accountId: string,
  securityId: string,
  qty: string,
): Posting[] {
  return [
    {
      accountId,
      amount: money(CAD, 0n),
      quantity: qtyFromDecimalString(qty),
      securityId,
    },
    { accountId: "ext", amount: money(CAD, 0n) },
  ];
}

function securitySell(
  accountId: string,
  securityId: string,
  qty: string,
  proceedsMinor: bigint,
): Posting[] {
  return [
    {
      accountId,
      amount: money(CAD, -proceedsMinor),
      quantity: qtyFromDecimalString(`-${qty}`),
      securityId,
    },
    { accountId: "cash", amount: money(CAD, proceedsMinor) },
  ];
}

function securityBuy(
  accountId: string,
  securityId: string,
  qty: string,
  costMinor: bigint,
): Posting[] {
  return [
    {
      accountId,
      amount: money(CAD, costMinor),
      quantity: qtyFromDecimalString(qty),
      securityId,
    },
    { accountId: "cash", amount: money(CAD, -costMinor) },
  ];
}

describe("unknown cost openings", () => {
  it("opening without cost yields Unknown position", () => {
    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      {
        id: "j-open",
        type: "OPENING",
        postings: openingWithoutCost("investment", "AAPL", "100"),
      },
      "ACB",
    );

    const pos = state.positions.get(positionKey("investment", "AAPL"));
    expect(pos).toBeDefined();
    expect(pos!.costState).toBe("Unknown");
    expect(pos!.acbCostReportingMinor).toBe(0n);
    expect(pos!.acbCostTradeMinor).toBe(0n);
  });

  it("sell with Unknown cost marks realized gain as Unknown", () => {
    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      {
        id: "j-open",
        type: "OPENING",
        postings: openingWithoutCost("investment", "AAPL", "100"),
      },
      "ACB",
    );
    state = applyPositionsForJournal(
      state,
      {
        id: "j-sell",
        type: "SELL",
        postings: securitySell("investment", "AAPL", "50", 50000n),
      },
      "ACB",
    );

    expect(state.realized).toHaveLength(1);
    const gain = state.realized[0]!;
    expect(gain.costState).toBe("Unknown");
    expect(gain.costTradeMinor).toBe(0n);
    expect(gain.costReportingMinor).toBe(0n);
    expect(gain.proceedsReportingMinor).toBe(50000n);
    expect(gain.gainReportingMinor).toBe(0n);
  });
});

describe("corporate actions", () => {
  it("split 2:1 doubles quantity with same total cost", () => {
    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      {
        id: "j-buy",
        type: "BUY",
        postings: securityBuy("investment", "AAPL", "100", 100000n),
      },
      "ACB",
    );

    state = applyPositionsForJournal(
      state,
      {
        id: "j-split",
        type: "CORPORATE_ACTION",
        corporateAction: { kind: "SPLIT", ratioN: 2n, ratioD: 1n },
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, 0n),
            quantity: qtyFromDecimalString("0"),
            securityId: "AAPL",
          },
        ],
      },
      "ACB",
    );

    const pos = state.positions.get(positionKey("investment", "AAPL"))!;
    expect(qtyToDecimalString(pos.quantity)).toBe("200.00000000");
    expect(pos.acbCostReportingMinor).toBe(100000n);
    expect(pos.acbCostTradeMinor).toBe(100000n);
  });

  it("return of capital reduces ACB", () => {
    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      {
        id: "j-buy",
        type: "BUY",
        postings: securityBuy("investment", "AAPL", "100", 100000n),
      },
      "ACB",
    );

    state = applyPositionsForJournal(
      state,
      {
        id: "j-roc",
        type: "CORPORATE_ACTION",
        corporateAction: {
          kind: "RETURN_OF_CAPITAL",
          reportingMinor: 20000n,
          tradeMinor: 20000n,
        },
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, 0n),
            quantity: qtyFromDecimalString("0"),
            securityId: "AAPL",
          },
        ],
      },
      "ACB",
    );

    const pos = state.positions.get(positionKey("investment", "AAPL"))!;
    expect(pos.acbCostReportingMinor).toBe(80000n);
    expect(qtyToDecimalString(pos.quantity)).toBe("100.00000000");
  });
});
