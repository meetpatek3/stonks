import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  replay,
  decomposeFxGain,
  type RealizedGain,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const accounts = new Map<string, Account>([
  ["ext", { id: "ext", type: "EXTERNAL", currency: "CAD" }],
  ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
]);

function dualCurrencySell(): RealizedGain {
  const journals: Journal[] = [
    {
      id: "j-buy-1",
      type: "BUY",
      tradeDate: "2024-01-01",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "investment",
          amount: money(CAD, 13500n),
          quantity: qtyFromDecimalString("10"),
          securityId: "AAPL",
          tradeCurrency: "USD",
          tradeAmountMinor: 10000n,
        },
        { accountId: "cash", amount: money(CAD, -13500n) },
      ],
    },
    {
      id: "j-buy-2",
      type: "BUY",
      tradeDate: "2024-01-02",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "investment",
          amount: money(CAD, 14800n),
          quantity: qtyFromDecimalString("10"),
          securityId: "AAPL",
          tradeCurrency: "USD",
          tradeAmountMinor: 11000n,
        },
        { accountId: "cash", amount: money(CAD, -14800n) },
      ],
    },
    {
      id: "j-sell",
      type: "SELL",
      tradeDate: "2024-01-03",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "investment",
          amount: money(CAD, -16000n),
          quantity: qtyFromDecimalString("-10"),
          securityId: "AAPL",
          tradeCurrency: "USD",
          tradeAmountMinor: -12000n,
        },
        { accountId: "cash", amount: money(CAD, 16000n) },
      ],
    },
  ];

  const state = replay(journals, accounts, "CAD");
  return state.realized[0]!;
}

describe("decomposeFxGain", () => {
  it("attributes all gain to asset when trade equals reporting currency", () => {
    const gain: RealizedGain = {
      accountId: "investment",
      securityId: "AAPL",
      journalId: "j-sell",
      quantitySold: qtyFromDecimalString("10"),
      tradeCurrency: "CAD",
      proceedsTradeMinor: 150000n,
      proceedsReportingMinor: 150000n,
      costTradeMinor: 110000n,
      costReportingMinor: 110000n,
      gainTradeMinor: 40000n,
      gainReportingMinor: 40000n,
      costState: "Known",
      sourceJournalIds: ["j-sell"],
    };

    const result = decomposeFxGain(gain, "CAD");
    expect(result.totalGainReporting).toBe(40000n);
    expect(result.assetMovementReporting).toBe(40000n);
    expect(result.currencyMovementReporting).toBe(0n);
  });

  it("splits dual-currency gain into asset and FX components", () => {
    const gain = dualCurrencySell();
    const result = decomposeFxGain(gain);

    expect(result.totalGainReporting).toBe(gain.gainReportingMinor);
    // gainTrade=1500, costTrade=10500, costReporting=14150 → asset = 1500*14150/10500 = 2021
    expect(result.assetMovementReporting).toBe(2021n);
    expect(result.currencyMovementReporting).toBe(
      result.totalGainReporting - result.assetMovementReporting,
    );
  });

  it("asset + currency always equals total (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        (costTrade, costReporting, proceedsTrade, proceedsReporting) => {
          const gainTrade = proceedsTrade - costTrade;
          const gainReporting = proceedsReporting - costReporting;
          const gain: RealizedGain = {
            accountId: "inv",
            securityId: "X",
            journalId: "j",
            quantitySold: qtyFromDecimalString("1"),
            tradeCurrency: "USD",
            proceedsTradeMinor: proceedsTrade,
            proceedsReportingMinor: proceedsReporting,
            costTradeMinor: costTrade,
            costReportingMinor: costReporting,
            gainTradeMinor: gainTrade,
            gainReportingMinor: gainReporting,
            costState: "Known",
            sourceJournalIds: ["j"],
          };

          const result = decomposeFxGain(gain);
          expect(
            result.assetMovementReporting + result.currencyMovementReporting,
          ).toBe(result.totalGainReporting);
        },
      ),
      { numRuns: 200 },
    );
  });
});
