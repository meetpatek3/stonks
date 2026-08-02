import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import {
  derivePortfolioSnapshot,
  type AccountMeta,
} from "@/lib/portfolio-derive";

/**
 * All expected values in this file are hand-calculated from the journals
 * declared in each test. Nothing here is snapshotted from implementation
 * output.
 */

const CAD_ACCOUNTS: AccountMeta[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

/** Legacy AAPL opening lot with no cost recorded: both amounts are zero. */
const openingUnknownCost: Journal = {
  id: "j-opening-aapl",
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
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 500_000n) },
    { accountId: "world", amount: money("CAD", -500_000n) },
  ],
};

/** Buy 100 XEQT for 2,500.00 CAD out of chequing. */
const buyOne: Journal = {
  id: "j-buy-1",
  type: "BUY",
  tradeDate: "2024-01-05",
  sortKey: 1,
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

/** Buy another 50 XEQT for 1,500.00 CAD, drawn on the credit facility. */
const buyTwoOnFacility: Journal = {
  id: "j-buy-2",
  type: "BUY",
  tradeDate: "2024-02-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 150_000n),
      quantity: qtyFromDecimalString("50"),
      securityId: "XEQT",
      tradeCurrency: "CAD",
      tradeAmountMinor: 150_000n,
    },
    { accountId: "facility", amount: money("CAD", -150_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 150_000n) }],
};

const BASE_JOURNALS: Journal[] = [openingUnknownCost, deposit, buyOne, buyTwoOnFacility];

function snapshot() {
  return derivePortfolioSnapshot({
    householdId: "hh-1",
    reportingCurrency: "CAD",
    accounts: CAD_ACCOUNTS,
    journals: BASE_JOURNALS,
  });
}

describe("derivePortfolioSnapshot balances", () => {
  it("derives per-account balances from replay", () => {
    const byId = new Map(snapshot().balances.map((row) => [row.accountId, row]));

    // chequing: +500,000 deposit, -250,000 buy = 250,000
    expect(byId.get("chequing")?.minor).toBe("250000");
    // brokerage: 0 opening + 250,000 + 150,000 = 400,000
    expect(byId.get("brokerage")?.minor).toBe("400000");
    // facility: single 150,000 draw = -150,000
    expect(byId.get("facility")?.minor).toBe("-150000");
    // world: -500,000 deposit funding + 0 opening
    expect(byId.get("world")?.minor).toBe("-500000");
  });

  it("groups balances by the ledger AccountType union", () => {
    const grouped = snapshot().balancesByType;

    expect(grouped.INVESTMENT.map((r) => r.accountId)).toEqual(["brokerage"]);
    expect(grouped.CASH.map((r) => r.accountId)).toEqual(["chequing"]);
    expect(grouped.CREDIT_FACILITY.map((r) => r.accountId)).toEqual(["facility"]);
    expect(grouped.EXTERNAL.map((r) => r.accountId)).toEqual(["world"]);
    expect(grouped.RECEIVABLE).toEqual([]);
  });
});

describe("derivePortfolioSnapshot totals", () => {
  it("derives net worth, invested and borrowed totals as minor-unit strings", () => {
    const snap = snapshot();

    // invested = brokerage 400,000
    expect(snap.totalInvestedMinor).toBe("400000");
    // borrowed = -(facility -150,000) = 150,000
    expect(snap.totalBorrowedMinor).toBe("150000");
    // net worth excludes EXTERNAL: 250,000 + 400,000 - 150,000 = 500,000
    expect(snap.netWorthMinor).toBe("500000");
    expect(snap.totalsAreUncertain).toBe(false);
  });

  it("never emits a negative-zero minor string", () => {
    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: CAD_ACCOUNTS,
      journals: [],
    });

    expect(snap.netWorthMinor).toBe("0");
    expect(snap.totalInvestedMinor).toBe("0");
    expect(snap.totalBorrowedMinor).toBe("0");
    expect(snap.balances).toEqual([]);
  });

  it("flags totals as uncertain and excludes balances that need an FX rate", () => {
    const usdAccounts: AccountMeta[] = [
      ...CAD_ACCOUNTS,
      { id: "usd-cash", name: "USD cash", type: "CASH", currency: "USD", minorUnits: 2 },
      { id: "usd-world", name: "USD world", type: "EXTERNAL", currency: "USD", minorUnits: 2 },
    ];
    const usdDeposit: Journal = {
      id: "j-usd-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-03-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "usd-cash", amount: money("USD", 100_000n) },
        { accountId: "usd-world", amount: money("USD", -100_000n) },
      ],
    };

    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: usdAccounts,
      journals: [...BASE_JOURNALS, usdDeposit],
    });

    expect(snap.totalsAreUncertain).toBe(true);
    // Unconverted USD 1,000.00 must not silently land in the CAD totals.
    expect(snap.netWorthMinor).toBe("500000");
    expect(snap.balances.find((r) => r.accountId === "usd-cash")?.minor).toBe("100000");
  });
});

describe("derivePortfolioSnapshot positions", () => {
  it("averages ACB cost across two buys of the same security", () => {
    const xeqt = snapshot().positions.find((p) => p.securityId === "XEQT");

    expect(xeqt).toBeDefined();
    expect(xeqt?.accountId).toBe("brokerage");
    expect(xeqt?.symbol).toBe("XEQT");
    // 100 + 50 shares
    expect(xeqt?.quantity).toBe("150.00000000");
    // 250,000 + 150,000 reporting-currency cost
    expect(xeqt?.costReportingMinor).toBe("400000");
    expect(xeqt?.costIsUnknown).toBe(false);
  });

  it("surfaces an unknown opening cost basis as uncertain, not zero", () => {
    const aapl = snapshot().positions.find((p) => p.securityId === "AAPL");

    expect(aapl).toBeDefined();
    expect(aapl?.quantity).toBe("10.00000000");
    expect(aapl?.costIsUnknown).toBe(true);
    expect(aapl?.costReportingMinor).toBeNull();
  });
});

describe("derivePortfolioSnapshot open items", () => {
  it("counts unknown-cost positions for the open-items badge", () => {
    const counts = snapshot().openItemCounts;

    expect(counts.unknownCost).toBe(1);
    expect(counts.total).toBe(1);
  });
});
