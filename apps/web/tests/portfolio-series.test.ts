import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import {
  derivePortfolioSnapshot,
  type AccountMeta,
} from "@/lib/portfolio-derive";

/**
 * Series, open items and tax read model.
 *
 * Every expected value here is hand-calculated from the journals declared in
 * this file. Nothing is snapshotted from implementation output.
 */

const ACCOUNTS: AccountMeta[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

/** Legacy AAPL lot opened with no cost recorded: cost state is Unknown. */
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

/** Deposit 5,000.00 into chequing. */
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

/** Buy 100 XEQT for 2,500.00 out of chequing. */
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

/**
 * Buy 50 more XEQT for 1,500.00, drawn on the facility.
 *
 * Note February has no journals at all — the gap between January and March is
 * what `valueOverTime` must carry forward.
 */
const buyTwoOnFacility: Journal = {
  id: "j-buy-2",
  type: "BUY",
  tradeDate: "2024-03-01",
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

/** XEQT dividend of 30.00 into chequing. */
const dividend: Journal = {
  id: "j-dividend",
  type: "DIVIDEND",
  tradeDate: "2024-03-15",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 3_000n) },
    { accountId: "world", amount: money("CAD", -3_000n) },
  ],
};

/** 10.00 of facility interest, capitalized onto the loan, wholly investment use. */
const interestCharged: Journal = {
  id: "j-interest-charged",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-04-30",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money("CAD", -1_000n) },
    { accountId: "world", amount: money("CAD", 1_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 1_000n) }],
};

/**
 * Sell 30 of the 150 XEQT for 1,200.00.
 *
 * Pooled ACB is 250,000 + 150,000 = 400,000 over 150 units, so the 30 sold
 * carry 400,000 x 30 / 150 = 80,000 and the realized gain is
 * 120,000 − 80,000 = 40,000.
 */
const sellPartial: Journal = {
  id: "j-sell-1",
  type: "SELL",
  tradeDate: "2024-05-10",
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

/** 5.00 of savings interest into chequing. */
const interestEarned: Journal = {
  id: "j-interest-earned",
  type: "INTEREST_EARNED",
  tradeDate: "2024-06-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 500n) },
    { accountId: "world", amount: money("CAD", -500n) },
  ],
};

/** A deposit two years later, so the ledger spans 2024 to 2026. */
const laterDeposit: Journal = {
  id: "j-deposit-2026",
  type: "DEPOSIT",
  tradeDate: "2026-03-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "chequing", amount: money("CAD", 10_000n) },
    { accountId: "world", amount: money("CAD", -10_000n) },
  ],
};

/**
 * Sell the whole unknown-cost AAPL lot for 900.00.
 *
 * The ledger reports a gain of zero for a disposal it has no cost for. Taking
 * that at face value would be wrong in the opposite direction to taking the
 * proceeds as gain, so the year must exclude it and say why.
 */
const sellUnknownCostLot: Journal = {
  id: "j-sell-aapl",
  type: "SELL",
  tradeDate: "2024-06-15",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", -90_000n),
      quantity: qtyFromDecimalString("-10"),
      securityId: "AAPL",
      tradeCurrency: "CAD",
      tradeAmountMinor: -90_000n,
    },
    { accountId: "chequing", amount: money("CAD", 90_000n) },
  ],
};

/**
 * A zero-cost acquisition: 5 units of SPINCO received for nothing.
 *
 * Unlike the AAPL opening lot, this cost is *known* — it is genuinely zero, as
 * for a gift or a spinoff — so `costIsUnknown` stays false. It still carries no
 * share of a cost allocation.
 */
const zeroCostSpinoff: Journal = {
  id: "j-spinco",
  type: "BUY",
  tradeDate: "2024-02-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    {
      accountId: "brokerage",
      amount: money("CAD", 0n),
      quantity: qtyFromDecimalString("5"),
      securityId: "SPINCO",
      tradeCurrency: "CAD",
      tradeAmountMinor: 0n,
    },
    { accountId: "world", amount: money("CAD", 0n) },
  ],
};

const BASE_JOURNALS: Journal[] = [
  openingUnknownCost,
  deposit,
  buyOne,
  buyTwoOnFacility,
  dividend,
  interestCharged,
  sellPartial,
  interestEarned,
];

function snapshot(taxYear?: number) {
  return derivePortfolioSnapshot({
    householdId: "hh-1",
    reportingCurrency: "CAD",
    accounts: ACCOUNTS,
    journals: BASE_JOURNALS,
    ...(taxYear === undefined ? {} : { taxYear }),
  });
}

describe("derivePortfolioSnapshot allocation", () => {
  it("labels the allocation as cost-based, since no market price source exists", () => {
    expect(snapshot().allocationBasis).toBe("COST");
  });

  it("gives the only known-cost position the whole 10000 bps", () => {
    const snap = snapshot();

    // Positions are AAPL (cost Unknown) and XEQT (ACB 400,000 − 80,000).
    expect(snap.allocation.map((row) => row.securityId)).toEqual(["XEQT"]);
    expect(snap.allocation[0]?.costReportingMinor).toBe("320000");
    expect(snap.allocation[0]?.bps).toBe(10000);
    // AAPL's cost is unknown, so it has no honest share — say so rather than
    // pretending the split covers everything.
    expect(snap.allocationIsIncomplete).toBe(true);
  });

  it("distributes the rounding remainder so bps sum to exactly 10000", () => {
    // Three positions of exactly equal cost: 10000 / 3 = 3333.33…, so naive
    // rounding gives 9999. Hamilton largest-remainder hands the leftover 1 to
    // the first position by index, giving 3334 / 3333 / 3333.
    const buys: Journal[] = ["AAA", "BBB", "CCC"].map((securityId, index) => ({
      id: `j-buy-${securityId}`,
      type: "BUY",
      tradeDate: "2024-01-10",
      sortKey: index,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", 100n),
          quantity: qtyFromDecimalString("1"),
          securityId,
          tradeCurrency: "CAD",
          tradeAmountMinor: 100n,
        },
        { accountId: "chequing", amount: money("CAD", -100n) },
      ],
    }));

    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [deposit, ...buys],
    });

    expect(snap.allocation.map((row) => row.securityId)).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
    expect(snap.allocation.map((row) => row.bps)).toEqual([3334, 3333, 3333]);
    expect(snap.allocation.reduce((sum, row) => sum + row.bps, 0)).toBe(10000);
    expect(snap.allocationIsIncomplete).toBe(false);
  });

  it("keeps each row's share aligned with its own cost", () => {
    // Distinct costs 5.00 / 3.00 / 2.00 out of 10.00 divide exactly:
    //   500 / 1000 = 50%   → 5000 bps
    //   300 / 1000 = 30%   → 3000 bps
    //   200 / 1000 = 20%   → 2000 bps
    // Equal weights cannot catch a row/share mis-pairing; these can.
    const costs: [string, bigint][] = [
      ["AAA", 500n],
      ["BBB", 300n],
      ["CCC", 200n],
    ];
    const buys: Journal[] = costs.map(([securityId, cost], index) => ({
      id: `j-buy-${securityId}`,
      type: "BUY",
      tradeDate: "2024-01-10",
      sortKey: index,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", cost),
          quantity: qtyFromDecimalString("1"),
          securityId,
          tradeCurrency: "CAD",
          tradeAmountMinor: cost,
        },
        { accountId: "chequing", amount: money("CAD", -cost) },
      ],
    }));

    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [deposit, ...buys],
    });

    expect(
      snap.allocation.map((row) => [row.securityId, row.costReportingMinor, row.bps]),
    ).toEqual([
      ["AAA", "500", 5000],
      ["BBB", "300", 3000],
      ["CCC", "200", 2000],
    ]);
    expect(snap.allocation.reduce((sum, row) => sum + row.bps, 0)).toBe(10000);
  });

  it("returns no allocation at all when there is nothing to divide", () => {
    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [deposit],
    });

    expect(snap.allocation).toEqual([]);
    expect(snap.allocationIsIncomplete).toBe(false);
  });
});

describe("derivePortfolioSnapshot valueOverTime", () => {
  it("derives month-end net worth by replay, carrying empty months forward", () => {
    // Hand-calculated month-end net worth (non-EXTERNAL accounts only):
    //   Jan: chequing 500,000 − 250,000 = 250,000; brokerage 250,000  → 500,000
    //   Feb: no journals, so identical to January                     → 500,000
    //   Mar: chequing 253,000; brokerage 400,000; facility −150,000   → 503,000
    //   Apr: facility −151,000 after capitalized interest             → 502,000
    //   May: sale moves 120,000 brokerage → chequing, net unchanged   → 502,000
    //   Jun: chequing 373,500                                        → 502,500
    expect(snapshot().valueOverTime).toEqual([
      { month: "2024-01", valueMinor: "500000", isUncertain: false },
      { month: "2024-02", valueMinor: "500000", isUncertain: false },
      { month: "2024-03", valueMinor: "503000", isUncertain: false },
      { month: "2024-04", valueMinor: "502000", isUncertain: false },
      { month: "2024-05", valueMinor: "502000", isUncertain: false },
      { month: "2024-06", valueMinor: "502500", isUncertain: false },
    ]);
  });

  it("ends the series at the last month-end value, matching netWorthMinor", () => {
    const snap = snapshot();
    const last = snap.valueOverTime[snap.valueOverTime.length - 1];

    expect(last?.valueMinor).toBe(snap.netWorthMinor);
  });

  it("has no points when there are no journals", () => {
    expect(
      derivePortfolioSnapshot({
        householdId: "hh-1",
        reportingCurrency: "CAD",
        accounts: ACCOUNTS,
        journals: [],
      }).valueOverTime,
    ).toEqual([]);
  });

  it("flags months whose value omits a balance needing an FX rate", () => {
    const usdAccounts: AccountMeta[] = [
      ...ACCOUNTS,
      { id: "usd-cash", name: "USD cash", type: "CASH", currency: "USD", minorUnits: 2 },
      { id: "usd-world", name: "USD world", type: "EXTERNAL", currency: "USD", minorUnits: 2 },
    ];
    const usdDeposit: Journal = {
      id: "j-usd-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-04-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "usd-cash", amount: money("USD", 100_000n) },
        { accountId: "usd-world", amount: money("USD", -100_000n) },
      ],
    };

    const points = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: usdAccounts,
      journals: [...BASE_JOURNALS, usdDeposit],
    }).valueOverTime;

    const byMonth = new Map(points.map((p) => [p.month, p]));
    // March predates the USD deposit, so its value is complete.
    expect(byMonth.get("2024-03")?.isUncertain).toBe(false);
    expect(byMonth.get("2024-03")?.valueMinor).toBe("503000");
    // From April the unconverted USD 1,000.00 is excluded, and the point says so.
    expect(byMonth.get("2024-04")?.isUncertain).toBe(true);
    expect(byMonth.get("2024-04")?.valueMinor).toBe("502000");
  });
});

describe("derivePortfolioSnapshot openItems", () => {
  it("raises an unknown-cost-basis item traced to the position key", () => {
    const items = snapshot().openItems.filter(
      (item) => item.kind === "UNKNOWN_COST_BASIS",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.refType).toBe("POSITION");
    expect(items[0]?.refId).toBe("brokerage:AAPL");
    expect(items[0]?.severity).toBe("WARNING");
    expect(items[0]?.message).toContain("AAPL");
  });

  it("raises a missing-FX-rate item traced to the account", () => {
    const usdAccounts: AccountMeta[] = [
      ...ACCOUNTS,
      { id: "usd-cash", name: "USD cash", type: "CASH", currency: "USD", minorUnits: 2 },
      { id: "usd-world", name: "USD world", type: "EXTERNAL", currency: "USD", minorUnits: 2 },
    ];
    const usdDeposit: Journal = {
      id: "j-usd-deposit",
      type: "DEPOSIT",
      tradeDate: "2024-04-01",
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
    const fx = snap.openItems.filter((item) => item.kind === "MISSING_FX_RATE");

    // Only the USD *cash* account is dropped from a total. The USD EXTERNAL
    // account never contributes to one, so it is not an open item.
    expect(fx).toHaveLength(1);
    expect(fx[0]?.refType).toBe("ACCOUNT");
    expect(fx[0]?.refId).toBe("usd-cash");
    expect(fx[0]?.severity).toBe("WARNING");
    expect(snap.openItemCounts.missingFxRate).toBe(1);
    expect(snap.openItemCounts.unknownCost).toBe(1);
    expect(snap.openItemCounts.total).toBe(snap.openItems.length);
  });

  it("names the zero-cost holding it dropped from the allocation", () => {
    // A known cost of exactly zero is honest data, but it carries no share of
    // a cost split. Saying only "incomplete" would leave the UI unable to name
    // which holding is missing, so this exclusion is traceable like the rest.
    const snap = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [...BASE_JOURNALS, zeroCostSpinoff],
    });

    const spinco = snap.positions.find((p) => p.securityId === "SPINCO");
    expect(spinco?.costIsUnknown).toBe(false);
    expect(spinco?.costReportingMinor).toBe("0");

    expect(snap.allocation.map((row) => row.securityId)).toEqual(["XEQT"]);
    expect(snap.allocationIsIncomplete).toBe(true);

    const items = snap.openItems.filter((item) => item.kind === "ZERO_COST_BASIS");
    expect(items).toHaveLength(1);
    expect(items[0]?.refType).toBe("POSITION");
    expect(items[0]?.refId).toBe("brokerage:SPINCO");
    expect(items[0]?.severity).toBe("INFO");
    expect(snap.openItemCounts.zeroCostBasis).toBe(1);
  });

  it("counts every open item, and reports none for a clean ledger", () => {
    const snap = snapshot();

    expect(snap.openItemCounts.total).toBe(snap.openItems.length);
    expect(snap.openItemCounts.total).toBe(1);

    const clean = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [deposit, buyOne],
    });
    expect(clean.openItems).toEqual([]);
    expect(clean.openItemCounts).toEqual({
      unknownCost: 0,
      missingFxRate: 0,
      zeroCostBasis: 0,
      total: 0,
    });
  });
});

describe("derivePortfolioSnapshot taxSummary", () => {
  it("summarizes the requested year from replayed realized gains and income", () => {
    const tax = snapshot(2024);

    expect(tax.taxSummary).not.toBeNull();
    expect(tax.taxSummary?.jurisdiction).toBe("CA");
    expect(tax.taxSummary?.year).toBe(2024);
    // Single sale: proceeds 120,000 − ACB 80,000 = 40,000 gain, no losses.
    expect(tax.taxSummary?.realizedGainsMinor).toBe("40000");
    expect(tax.taxSummary?.realizedLossesMinor).toBe("0");
    // Default Canadian inclusion rate: 40,000 x 5000 / 10000 = 20,000.
    expect(tax.taxSummary?.inclusionRateBps).toBe(5000);
    expect(tax.taxSummary?.taxableCapitalGainsMinor).toBe("20000");
    expect(tax.taxSummary?.dividendIncomeMinor).toBe("3000");
    expect(tax.taxSummary?.interestIncomeMinor).toBe("500");
    // Facility interest wholly attributed to INVESTMENT use.
    expect(tax.taxSummary?.deductibleInterestExpenseMinor).toBe("1000");
    expect(tax.taxSummary?.flags).toEqual([]);
    expect(tax.taxSummary?.disclaimer.toLowerCase()).toContain("not tax advice");
    expect(tax.taxSummary?.isUncertain).toBe(false);
  });

  it("defaults to the year of the most recent posted journal", () => {
    expect(snapshot().taxSummary?.year).toBe(2024);
  });

  it("reports a quiet year inside the ledger's range as genuinely zero", () => {
    // The ledger spans 2024 to 2026, so 2025 is covered and really was quiet:
    // those zeroes are facts, and flagging them would cry wolf.
    const tax = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [...BASE_JOURNALS, laterDeposit],
      taxYear: 2025,
    }).taxSummary;

    expect(tax?.year).toBe(2025);
    expect(tax?.realizedGainsMinor).toBe("0");
    expect(tax?.dividendIncomeMinor).toBe("0");
    expect(tax?.taxableCapitalGainsMinor).toBe("0");
    expect(tax?.isUncertain).toBe(false);
    expect(tax?.uncertaintyReasons).toEqual([]);
  });

  it("flags a year outside the ledger's range instead of reporting zeroes", () => {
    // This ledger begins in 2024. "You had no gains in 2023" would be a claim
    // about the household; the truth is only that the ledger says nothing.
    const tax = snapshot(2023).taxSummary;

    expect(tax?.year).toBe(2023);
    expect(tax?.isUncertain).toBe(true);
    expect(tax?.uncertaintyReasons.join(" ")).toContain("2024");
    expect(tax?.uncertaintyReasons.join(" ")).toContain("2023");
  });

  it("marks the summary uncertain rather than fabricating a figure", () => {
    // Interest charged with no facility draw carries no use attribution, so
    // the deductible portion is not derivable — flag it, do not guess it.
    const payDirectInterest: Journal = {
      id: "j-interest-paid-cash",
      type: "INTEREST_CHARGED",
      tradeDate: "2024-07-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "world", amount: money("CAD", 800n) },
        { accountId: "chequing", amount: money("CAD", -800n) },
      ],
    };

    const tax = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [...BASE_JOURNALS, payDirectInterest],
      taxYear: 2024,
    }).taxSummary;

    expect(tax?.isUncertain).toBe(true);
    expect(tax?.uncertaintyReasons.join(" ")).toContain("j-interest-paid-cash");
    // The un-attributable 800 must not silently join the deductible figure.
    expect(tax?.deductibleInterestExpenseMinor).toBe("1000");
  });

  it("excludes a disposal whose cost basis is unknown, rather than counting it", () => {
    const tax = derivePortfolioSnapshot({
      householdId: "hh-1",
      reportingCurrency: "CAD",
      accounts: ACCOUNTS,
      journals: [...BASE_JOURNALS, sellUnknownCostLot],
      taxYear: 2024,
    }).taxSummary;

    // The XEQT sale still contributes its 40,000. The AAPL sale contributes
    // nothing: neither its 90,000 proceeds (which would be the gain only if
    // the cost were truly zero) nor the ledger's placeholder gain of zero
    // (which would read as "sold at exactly break-even").
    expect(tax?.realizedGainsMinor).toBe("40000");
    expect(tax?.taxableCapitalGainsMinor).toBe("20000");
    expect(tax?.isUncertain).toBe(true);
    const reasons = tax?.uncertaintyReasons.join(" ") ?? "";
    expect(reasons).toContain("j-sell-aapl");
    expect(reasons).toContain("AAPL");
  });

  it("has no tax summary when there is no ledger activity to summarize", () => {
    expect(
      derivePortfolioSnapshot({
        householdId: "hh-1",
        reportingCurrency: "CAD",
        accounts: ACCOUNTS,
        journals: [],
      }).taxSummary,
    ).toBeNull();
  });
});
