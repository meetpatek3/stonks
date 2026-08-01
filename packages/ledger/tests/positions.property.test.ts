import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  replay,
  positionKey,
  applyPositionsForJournal,
  emptyPositionState,
} from "../src/index.js";
import { buySellChainArb } from "../src/testing/arbitrary.js";
import type { Journal } from "../src/ledger/types.js";
import { CAD, money } from "../src/index.js";

const KEY = positionKey("investment", "TEST");

describe("cost basis properties", () => {
  it("final quantity equals buys minus sells", () => {
    fc.assert(
      fc.property(buySellChainArb, (chain) => {
        const state = replay(chain.journals, chain.accounts, "CAD");
        const expected = chain.totalBuyQtyScaled - chain.totalSellQtyScaled;
        if (expected === 0n) {
          expect(state.positions.has(KEY)).toBe(false);
          expect(state.quantities.has(KEY)).toBe(false);
        } else {
          expect(state.positions.get(KEY)?.quantity.scaled).toBe(expected);
          expect(state.quantities.get(KEY)?.scaled).toBe(expected);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("full disposal: realized cost sums to buy costs (ACB and FIFO)", () => {
    fc.assert(
      fc.property(buySellChainArb, (chain) => {
        // Force full disposal by appending a final sell of remainder when needed
        const journals = ensureFullDisposal(chain);
        for (const method of ["ACB", "FIFO"] as const) {
          const state = replay(journals, chain.accounts, "CAD", {
            costBasisMethod: method,
          });
          expect(state.positions.has(KEY)).toBe(false);
          const realizedCost = state.realized.reduce(
            (sum, g) => sum + g.costReportingMinor,
            0n,
          );
          expect(realizedCost).toBe(chain.totalBuyCostReporting);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("realized gain identity holds exactly", () => {
    fc.assert(
      fc.property(buySellChainArb, (chain) => {
        const state = replay(chain.journals, chain.accounts, "CAD");
        for (const gain of state.realized) {
          expect(gain.gainReportingMinor).toBe(
            gain.proceedsReportingMinor - gain.costReportingMinor,
          );
          expect(gain.gainTradeMinor).toBe(
            gain.proceedsTradeMinor - gain.costTradeMinor,
          );
        }
      }),
      { numRuns: 50 },
    );
  });

  it("quantities stay in sync with positions", () => {
    fc.assert(
      fc.property(buySellChainArb, (chain) => {
        const state = replay(chain.journals, chain.accounts, "CAD", {
          costBasisMethod: "FIFO",
        });
        for (const [key, qty] of state.quantities) {
          expect(state.positions.get(key)?.quantity.scaled).toBe(qty.scaled);
        }
        for (const [key, pos] of state.positions) {
          expect(state.quantities.get(key)?.scaled).toBe(pos.quantity.scaled);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("ACB and FIFO can disagree on partial sells with unequal lot prices", () => {
    const journals: Journal[] = [
      {
        id: "b1",
        type: "BUY",
        tradeDate: "2024-01-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, 100000n),
            quantity: { scaled: 100_00000000n },
            securityId: "TEST",
          },
          { accountId: "cash", amount: money(CAD, -100000n) },
        ],
      },
      {
        id: "b2",
        type: "BUY",
        tradeDate: "2024-01-02",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, 200000n),
            quantity: { scaled: 100_00000000n },
            securityId: "TEST",
          },
          { accountId: "cash", amount: money(CAD, -200000n) },
        ],
      },
      {
        id: "s1",
        type: "SELL",
        tradeDate: "2024-01-03",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, -150000n),
            quantity: { scaled: -100_00000000n },
            securityId: "TEST",
          },
          { accountId: "cash", amount: money(CAD, 150000n) },
        ],
      },
    ];

    let acb = emptyPositionState();
    let fifo = emptyPositionState();
    for (const journal of journals) {
      acb = applyPositionsForJournal(acb, journal, "ACB");
      fifo = applyPositionsForJournal(fifo, journal, "FIFO");
    }
    expect(acb.realized[0]?.gainReportingMinor).not.toBe(
      fifo.realized[0]?.gainReportingMinor,
    );
  });
});

function ensureFullDisposal(chain: {
  journals: Journal[];
  totalBuyQtyScaled: bigint;
  totalSellQtyScaled: bigint;
}): Journal[] {
  const remaining = chain.totalBuyQtyScaled - chain.totalSellQtyScaled;
  if (remaining === 0n) return chain.journals;

  const proceeds = (remaining / 1_00000000n) * 50_00n + 1n;
  return [
    ...chain.journals,
    {
      id: "final-sell",
      type: "SELL",
      tradeDate: "2024-12-31",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "investment",
          amount: money(CAD, -proceeds),
          quantity: { scaled: -remaining },
          securityId: "TEST",
        },
        { accountId: "cash", amount: money(CAD, proceeds) },
      ],
    },
  ];
}
