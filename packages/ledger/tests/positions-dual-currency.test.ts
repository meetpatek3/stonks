import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  qtyToDecimalString,
  emptyPositionState,
  applyPositionsForJournal,
  positionKey,
  ValidationError,
} from "../src/index.js";
import type { Posting } from "../src/ledger/types.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/ledger/dual-currency-usd-cad.json",
);

function dualBuy(
  qty: string,
  tradeMinor: bigint,
  reportingMinor: bigint,
): Posting[] {
  return [
    {
      accountId: "investment",
      amount: money(CAD, reportingMinor),
      quantity: qtyFromDecimalString(qty),
      securityId: "AAPL",
      tradeCurrency: "USD",
      tradeAmountMinor: tradeMinor,
    },
    { accountId: "cash", amount: money(CAD, -reportingMinor) },
  ];
}

function dualSell(
  qty: string,
  tradeProceeds: bigint,
  reportingProceeds: bigint,
): Posting[] {
  return [
    {
      accountId: "investment",
      amount: money(CAD, -reportingProceeds),
      quantity: qtyFromDecimalString(`-${qty}`),
      securityId: "AAPL",
      tradeCurrency: "USD",
      tradeAmountMinor: -tradeProceeds,
    },
    { accountId: "cash", amount: money(CAD, reportingProceeds) },
  ];
}

describe("dual-currency ACB", () => {
  it("matches hand-calculated USD/CAD fixture", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      expectedAfter: {
        positionKey: string;
        quantity: string;
        acbCostTradeMinor: string;
        acbCostReportingMinor: string;
        realized: Array<{
          journalId: string;
          costTradeMinor: string;
          costReportingMinor: string;
          proceedsTradeMinor: string;
          proceedsReportingMinor: string;
          gainTradeMinor: string;
          gainReportingMinor: string;
        }>;
      };
    };

    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      { id: "j-buy-1", postings: dualBuy("10", 10000n, 13500n) },
      "ACB",
    );
    state = applyPositionsForJournal(
      state,
      { id: "j-buy-2", postings: dualBuy("10", 11000n, 14800n) },
      "ACB",
    );
    state = applyPositionsForJournal(
      state,
      { id: "j-sell", postings: dualSell("10", 12000n, 16000n) },
      "ACB",
    );

    const key = positionKey("investment", "AAPL");
    const position = state.positions.get(key);
    expect(position).toBeDefined();
    expect(qtyToDecimalString(position!.quantity)).toBe(fixture.expectedAfter.quantity);
    expect(position!.tradeCurrency).toBe("USD");
    expect(position!.acbCostTradeMinor).toBe(
      BigInt(fixture.expectedAfter.acbCostTradeMinor),
    );
    expect(position!.acbCostReportingMinor).toBe(
      BigInt(fixture.expectedAfter.acbCostReportingMinor),
    );

    const gain = state.realized[0]!;
    const expected = fixture.expectedAfter.realized[0]!;
    expect(gain.costTradeMinor).toBe(BigInt(expected.costTradeMinor));
    expect(gain.costReportingMinor).toBe(BigInt(expected.costReportingMinor));
    expect(gain.proceedsTradeMinor).toBe(BigInt(expected.proceedsTradeMinor));
    expect(gain.proceedsReportingMinor).toBe(BigInt(expected.proceedsReportingMinor));
    expect(gain.gainTradeMinor).toBe(BigInt(expected.gainTradeMinor));
    expect(gain.gainReportingMinor).toBe(BigInt(expected.gainReportingMinor));
  });

  it("rejects trade currency mismatch on sell", () => {
    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      { id: "j-buy-1", postings: dualBuy("10", 10000n, 13500n) },
      "ACB",
    );

    expect(() =>
      applyPositionsForJournal(
        state,
        {
          id: "j-sell",
          postings: [
            {
              accountId: "investment",
              amount: money(CAD, -16000n),
              quantity: qtyFromDecimalString("-10"),
              securityId: "AAPL",
              tradeCurrency: "CAD",
              tradeAmountMinor: -16000n,
            },
            { accountId: "cash", amount: money(CAD, 16000n) },
          ],
        },
        "ACB",
      ),
    ).toThrow(ValidationError);
  });
});
