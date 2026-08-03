import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import { derivePortfolioSnapshot, type AccountMeta } from "@/lib/portfolio-derive";

/**
 * Per-position realized gains in the read model.
 *
 * The MCP `list_positions` tool needs realized gains to date per held
 * position, and no tool may compute a gain itself — so the read model derives
 * it from replay's own disposition records. All expectations below are
 * hand-calculated from the journals declared here.
 */

const ACCOUNTS: AccountMeta[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

/** Opening lot of 10 AAPL with no cost recorded (both amounts zero). */
const openingUnknownAapl: Journal = {
  id: "j-open-aapl",
  type: "OPENING",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 0n),
      quantity: qtyFromDecimalString("10"),
      securityId: "AAPL",
      tradeCurrency: "CAD",
      tradeAmountMinor: 0n,
    },
    { accountId: "world", amount: money("CAD", 0n) },
  ],
};

/** Deposit 5,000.00 CAD into chequing. */
const deposit: Journal = {
  id: "j-deposit",
  type: "DEPOSIT",
  tradeDate: "2024-01-02",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 500_000n) },
    { accountId: "world", amount: money("CAD", -500_000n) },
  ],
};

/** Buy 100 XEQT for 2,500.00 CAD out of chequing. */
const buyXeqt: Journal = {
  id: "j-buy-xeqt",
  type: "BUY",
  tradeDate: "2024-01-05",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 250_000n),
      quantity: qtyFromDecimalString("100"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: 250_000n,
    },
    { accountId: "chequing", amount: money("CAD", -250_000n) },
  ],
};

/** Buy 5 MSFT for 100.00 CAD — never sold, so its realized gain is a real zero. */
const buyMsft: Journal = {
  id: "j-buy-msft",
  type: "BUY",
  tradeDate: "2024-01-06",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 10_000n),
      quantity: qtyFromDecimalString("5"),
      securityId: "MSFT",
      tradeCurrency: "CAD",
      tradeAmountMinor: 10_000n,
    },
    { accountId: "chequing", amount: money("CAD", -10_000n) },
  ],
};

/**
 * Sell 30 of 100 XEQT for 1,200.00 CAD.
 *
 * ACB cost of the lot sold: allocateCost(250_000, 30, 100) = 75_000.
 * Realized gain: 120_000 − 75_000 = 45_000.
 */
const sellXeqt: Journal = {
  id: "j-sell-xeqt",
  type: "SELL",
  tradeDate: "2024-03-05",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", -120_000n),
      quantity: qtyFromDecimalString("-30"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: -120_000n,
    },
    { accountId: "chequing", amount: money("CAD", 120_000n) },
  ],
};

/** Sell 4 AAPL (unknown cost) for 500.00 CAD — the gain is not derivable. */
const sellAapl: Journal = {
  id: "j-sell-aapl",
  type: "SELL",
  tradeDate: "2024-04-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", -50_000n),
      quantity: qtyFromDecimalString("-4"),
      securityId: "AAPL",
      tradeCurrency: "CAD",
      tradeAmountMinor: -50_000n,
    },
    { accountId: "chequing", amount: money("CAD", 50_000n) },
  ],
};

const JOURNALS = [openingUnknownAapl, deposit, buyXeqt, buyMsft, sellXeqt, sellAapl];

function positionRows() {
  const snapshot = derivePortfolioSnapshot({
    reportingCurrency: "CAD",
    reportingMinorUnits: 2,
    accounts: ACCOUNTS,
    journals: JOURNALS,
  });
  return snapshot.positions;
}

describe("per-position realized gains", () => {
  it("sums replay's disposition records for a held position, with trace ids", () => {
    const xeqt = positionRows().find((p) => p.securityId === "XEQT");
    expect(xeqt).toBeDefined();
    // 120_000 proceeds − 75_000 ACB of 30/100 units = 45_000.
    expect(xeqt!.realizedGainReportingMinor).toBe("45000");
    expect(xeqt!.realizedGainUncertaintyReason).toBeNull();
    expect(xeqt!.realizedSourceJournalIds).toEqual(["j-sell-xeqt"]);
  });

  it("is null with a reason — never \"0\" — when a disposition had unknown cost", () => {
    const aapl = positionRows().find((p) => p.securityId === "AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.costIsUnknown).toBe(true);
    expect(aapl!.realizedGainReportingMinor).toBeNull();
    expect(aapl!.realizedGainUncertaintyReason).toContain("AAPL");
    expect(aapl!.realizedGainUncertaintyReason).toContain("cost basis");
    // Traceability survives even when the figure cannot be stated.
    expect(aapl!.realizedSourceJournalIds).toEqual(["j-sell-aapl"]);
  });

  it("is a real zero for a position that was never sold", () => {
    const msft = positionRows().find((p) => p.securityId === "MSFT");
    expect(msft).toBeDefined();
    expect(msft!.realizedGainReportingMinor).toBe("0");
    expect(msft!.realizedGainUncertaintyReason).toBeNull();
    expect(msft!.realizedSourceJournalIds).toEqual([]);
  });

  it("keeps every realized-gain money field a string, not a JSON number", () => {
    for (const row of positionRows()) {
      if (row.realizedGainReportingMinor !== null) {
        expect(typeof row.realizedGainReportingMinor).toBe("string");
      }
    }
  });
});
