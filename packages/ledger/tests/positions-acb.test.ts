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
  "../../../fixtures/ledger/acb-cad-roundtrip.json",
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
  const negQty = qtyFromDecimalString(`-${qty}`);
  return [
    {
      accountId,
      amount: money(CAD, -proceedsMinor),
      quantity: negQty,
      securityId,
    },
    { accountId: "cash", amount: money(CAD, proceedsMinor) },
  ];
}

describe("ACB cost basis", () => {
  it("matches hand-calculated two-buy half-sell fixture", () => {
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
      "ACB",
    );
    state = applyPositionsForJournal(
      state,
      {
        id: "j-buy-2",
        postings: securityBuy("investment", "AAPL", "100", 120000n),
      },
      "ACB",
    );
    state = applyPositionsForJournal(
      state,
      {
        id: "j-sell",
        postings: securitySell("investment", "AAPL", "100", 150000n),
      },
      "ACB",
    );

    const key = positionKey("investment", "AAPL");
    expect(key).toBe(fixture.expectedAfter.positionKey);
    const position = state.positions.get(key);
    expect(position).toBeDefined();
    expect(qtyToDecimalString(position!.quantity)).toBe(fixture.expectedAfter.quantity);
    expect(position!.acbCostReportingMinor).toBe(
      BigInt(fixture.expectedAfter.acbCostReportingMinor),
    );
    expect(position!.lots).toEqual([]);

    expect(state.realized).toHaveLength(1);
    const gain = state.realized[0]!;
    const expected = fixture.expectedAfter.realized[0]!;
    expect(gain.journalId).toBe(expected.journalId);
    expect(gain.costReportingMinor).toBe(BigInt(expected.costReportingMinor));
    expect(gain.proceedsReportingMinor).toBe(BigInt(expected.proceedsReportingMinor));
    expect(gain.gainReportingMinor).toBe(BigInt(expected.gainReportingMinor));
  });
});
