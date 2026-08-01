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
} from "../src/index.js";
import type { Posting } from "../src/ledger/types.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/ledger/fifo-cad-roundtrip.json",
);

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

describe("FIFO cost basis", () => {
  it("matches hand-calculated two-buy first-lot sell fixture", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      expectedAfter: {
        positionKey: string;
        quantity: string;
        acbCostReportingMinor: string;
        realized: Array<{
          journalId: string;
          costReportingMinor: string;
          proceedsReportingMinor: string;
          gainReportingMinor: string;
        }>;
      };
    };

    let state = emptyPositionState();
    state = applyPositionsForJournal(
      state,
      {
        id: "j-buy-1",
        postings: securityBuy("investment", "AAPL", "100", 100000n),
      },
      "FIFO",
    );
    state = applyPositionsForJournal(
      state,
      {
        id: "j-buy-2",
        postings: securityBuy("investment", "AAPL", "100", 120000n),
      },
      "FIFO",
    );
    state = applyPositionsForJournal(
      state,
      {
        id: "j-sell",
        postings: securitySell("investment", "AAPL", "100", 150000n),
      },
      "FIFO",
    );

    const key = positionKey("investment", "AAPL");
    const position = state.positions.get(key);
    expect(position).toBeDefined();
    expect(qtyToDecimalString(position!.quantity)).toBe(fixture.expectedAfter.quantity);
    expect(position!.acbCostReportingMinor).toBe(
      BigInt(fixture.expectedAfter.acbCostReportingMinor),
    );
    expect(position!.lots).toHaveLength(1);
    expect(position!.lots[0]?.acquiredJournalId).toBe("j-buy-2");
    expect(position!.lots[0]?.costReportingMinor).toBe(120000n);

    const gain = state.realized[0]!;
    const expected = fixture.expectedAfter.realized[0]!;
    expect(gain.costReportingMinor).toBe(BigInt(expected.costReportingMinor));
    expect(gain.proceedsReportingMinor).toBe(BigInt(expected.proceedsReportingMinor));
    expect(gain.gainReportingMinor).toBe(BigInt(expected.gainReportingMinor));
    expect(gain.sourceJournalIds).toContain("j-buy-1");
    expect(gain.sourceJournalIds).toContain("j-sell");
  });

  it("differs from ACB on the same trades", () => {
    const journals = [
      {
        id: "j-buy-1",
        postings: securityBuy("investment", "AAPL", "100", 100000n),
      },
      {
        id: "j-buy-2",
        postings: securityBuy("investment", "AAPL", "100", 120000n),
      },
      {
        id: "j-sell",
        postings: securitySell("investment", "AAPL", "100", 150000n),
      },
    ];

    let acb = emptyPositionState();
    let fifo = emptyPositionState();
    for (const journal of journals) {
      acb = applyPositionsForJournal(acb, journal, "ACB");
      fifo = applyPositionsForJournal(fifo, journal, "FIFO");
    }

    expect(acb.realized[0]?.gainReportingMinor).toBe(40000n);
    expect(fifo.realized[0]?.gainReportingMinor).toBe(50000n);
  });
});
