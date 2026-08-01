import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  qtyFromDecimalString,
  replay,
  ValidationError,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const accounts = new Map<string, Account>([
  ["ext", { id: "ext", type: "EXTERNAL", currency: "CAD" }],
  ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
]);

const SECURITY = "AAPL";
const QTY = qtyFromDecimalString("10");

function buyJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
): Journal {
  return {
    id,
    type: "BUY",
    tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      {
        accountId: "investment",
        amount: money(CAD, 1000n),
        quantity: QTY,
        securityId: SECURITY,
      },
      { accountId: "cash", amount: money(CAD, -1000n) },
    ],
  };
}

function sellJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
): Journal {
  return {
    id,
    type: "SELL",
    tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      {
        accountId: "investment",
        amount: money(CAD, -1000n),
        quantity: qtyFromDecimalString("-10"),
        securityId: SECURITY,
      },
      { accountId: "cash", amount: money(CAD, 1000n) },
    ],
  };
}

describe("same-day ordering and negative quantity guard", () => {
  it("allows same-day BUY then SELL when sortKey orders buy first", () => {
    const journals = [
      buyJournal("j-buy", "2024-06-01", 0),
      sellJournal("j-sell", "2024-06-01", 1),
    ];

    const state = replay(journals, accounts, "CAD");

    expect(state.quantities.size).toBe(0);
  });

  it("rejects same-day SELL before BUY via sortKey", () => {
    const journals = [
      sellJournal("j-sell", "2024-06-01", 0),
      buyJournal("j-buy", "2024-06-01", 1),
    ];

    expect(() => replay(journals, accounts, "CAD")).toThrow(ValidationError);
    try {
      replay(journals, accounts, "CAD");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const error = err as ValidationError;
      expect(error.code).toBe("NEGATIVE_QUANTITY");
      expect(error.journalIds).toContain("j-sell");
    }
  });

  it("rejects sell-day before buy-day without reordering journals", () => {
    const journals = [
      sellJournal("j-sell", "2024-06-01", 0),
      buyJournal("j-buy", "2024-06-02", 0),
    ];

    expect(() => replay(journals, accounts, "CAD")).toThrow(ValidationError);
    try {
      replay(journals, accounts, "CAD");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const error = err as ValidationError;
      expect(error.code).toBe("NEGATIVE_QUANTITY");
      expect(error.journalIds).toContain("j-sell");
    }
  });
});
