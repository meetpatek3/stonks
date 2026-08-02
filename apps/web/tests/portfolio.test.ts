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

/**
 * Sell 30 of the 150 XEQT for 1,200.00 CAD into chequing.
 *
 * This is what forces per-unit ACB to be exercised: the remaining cost is
 * 400,000 − allocateCost(400,000, 30, 150) = 400,000 − 80,000 = 320,000, which
 * deliberately differs from the brokerage account's replay balance (280,000),
 * so reading the balance instead of the position's cost cannot pass.
 */
const sellPartial: Journal = {
  id: "j-sell-1",
  type: "SELL",
  tradeDate: "2024-03-05",
  sortKey: 1,
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

const BASE_JOURNALS: Journal[] = [
  openingUnknownCost,
  deposit,
  buyOne,
  buyTwoOnFacility,
  sellPartial,
];

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

    // chequing: +500,000 deposit − 250,000 buy + 120,000 sale = 370,000
    expect(byId.get("chequing")?.minor).toBe("370000");
    // brokerage: 0 opening + 250,000 + 150,000 − 120,000 = 280,000
    expect(byId.get("brokerage")?.minor).toBe("280000");
    // facility: single 150,000 draw = -150,000
    expect(byId.get("facility")?.minor).toBe("-150000");
    // world: -500,000 deposit funding + 0 opening
    expect(byId.get("world")?.minor).toBe("-500000");
  });

  it("propagates the replay ledger version", () => {
    // Five posted journals, one applyJournal step each.
    expect(snapshot().ledgerVersion).toBe(5);
    expect(
      derivePortfolioSnapshot({
        householdId: "hh-1",
        reportingCurrency: "CAD",
        accounts: CAD_ACCOUNTS,
        journals: [],
      }).ledgerVersion,
    ).toBe(0);
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

    // invested = brokerage 280,000
    expect(snap.totalInvestedMinor).toBe("280000");
    // borrowed = -(facility -150,000) = 150,000
    expect(snap.totalBorrowedMinor).toBe("150000");
    // net worth excludes EXTERNAL: 370,000 + 280,000 - 150,000 = 500,000
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

  it("does not flag uncertainty for a foreign-currency EXTERNAL account", () => {
    // EXTERNAL accounts never contribute to a total, so an unconvertible one
    // drops nothing — the totals are complete and must not claim otherwise.
    const usdExternalAccounts: AccountMeta[] = [
      ...CAD_ACCOUNTS,
      { id: "usd-world", name: "USD outside world", type: "EXTERNAL", currency: "USD", minorUnits: 2 },
      { id: "usd-payer", name: "USD payer", type: "EXTERNAL", currency: "USD", minorUnits: 2 },
    ];
    const usdExternalTransfer: Journal = {
      id: "j-usd-external",
      type: "TRANSFER",
      tradeDate: "2024-03-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "usd-world", amount: money("USD", 100_000n) },
        { accountId: "usd-payer", amount: money("USD", -100_000n) },
      ],
    };

    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: usdExternalAccounts,
      journals: [...BASE_JOURNALS, usdExternalTransfer],
    });

    expect(snap.totalsAreUncertain).toBe(false);
    expect(snap.netWorthMinor).toBe("500000");
    expect(snap.balancesByType.EXTERNAL.map((r) => r.accountId).sort()).toEqual([
      "usd-payer",
      "usd-world",
      "world",
    ]);
  });
});

describe("derivePortfolioSnapshot positions", () => {
  it("carries per-unit ACB cost across two buys and a partial sale", () => {
    const snap = snapshot();
    const xeqt = snap.positions.find((p) => p.securityId === "XEQT");

    expect(xeqt).toBeDefined();
    expect(xeqt?.accountId).toBe("brokerage");
    expect(xeqt?.symbol).toBe("XEQT");
    // 100 + 50 bought, 30 sold
    expect(xeqt?.quantity).toBe("120.00000000");
    // Pooled cost 250,000 + 150,000 = 400,000 over 150 units; the 30 sold
    // carry 400,000 x 30 / 150 = 80,000, leaving 320,000.
    expect(xeqt?.costReportingMinor).toBe("320000");
    expect(xeqt?.costIsUnknown).toBe(false);
    // The remaining cost must not be the account balance (280,000): reading
    // the balance instead of the position's ACB would be a different number.
    expect(xeqt?.costReportingMinor).not.toBe(
      snap.balances.find((r) => r.accountId === "brokerage")?.minor,
    );
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
