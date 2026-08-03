import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString, type Journal } from "@stonks/ledger";
import {
  derivePortfolioSnapshot,
  heldSecurityIds,
  type AccountMeta,
} from "@/lib/portfolio-derive";
import type { ResolvedPrice } from "@/lib/market/price-service";
import { emptyPortfolioSnapshot } from "@/lib/portfolio-shared";

/**
 * Valuation in the read model: market value, unrealized gain, and returns
 * gross and net of borrowing cost.
 *
 * Every expected value here is hand-calculated from the journals declared in
 * this file, and every price is injected — no database, no network, no
 * snapshotted output.
 *
 * The running example, used by most tests below:
 *
 *   150 XEQT held at a pooled ACB of 4,000.00 CAD
 *     100 bought at 2,500.00 out of cash
 *      50 bought at 1,500.00 drawn on the credit facility
 *   marked at 30.00 CAD  ->  market value 4,500.00
 *   100.00 of investment-use interest charged on the facility
 *
 *   unrealized gain = 4,500.00 - 4,000.00 =   500.00  ->     50000 minor
 *   gross return    =    50000 * 10000 / 400000 =  1250 bps (12.50%)
 *   net return      =   (50000 - 10000) * 10000 / 400000 = 1000 bps (10.00%)
 */

const ACCOUNTS: AccountMeta[] = [
  { id: "brokerage", name: "Brokerage", type: "INVESTMENT", currency: "CAD", minorUnits: 2 },
  { id: "chequing", name: "Chequing", type: "CASH", currency: "CAD", minorUnits: 2 },
  { id: "facility", name: "Investment loan", type: "CREDIT_FACILITY", currency: "CAD", minorUnits: 2 },
  { id: "world", name: "Outside world", type: "EXTERNAL", currency: "CAD", minorUnits: 2 },
];

const AS_OF = "2024-03-31";

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

/** 100.00 CAD of interest charged on the facility, all investment use. */
const interestCharged: Journal = {
  id: "j-interest",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-03-01",
  sortKey: 1,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money("CAD", -10_000n) },
    { accountId: "world", amount: money("CAD", 10_000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money("CAD", 10_000n) }],
};

const BASE_JOURNALS: Journal[] = [deposit, buyOne, buyTwoOnFacility, interestCharged];

/** A resolved quote in CAD, dated the valuation date unless overridden. */
function quote(
  securityId: string,
  priceMinor: bigint,
  overrides: Partial<ResolvedPrice> = {},
): ResolvedPrice {
  return {
    securityId,
    source: "QUOTE",
    priceMinor,
    currency: "CAD",
    minorUnits: 2,
    asOf: AS_OF,
    requestedAsOf: AS_OF,
    stale: false,
    ...overrides,
  };
}

/** A security with no price at all — what the service returns for an unquotable holding. */
function noPrice(securityId: string, currency = "CAD"): ResolvedPrice {
  return {
    securityId,
    source: "NONE",
    priceMinor: null,
    currency,
    minorUnits: 2,
    asOf: null,
    requestedAsOf: AS_OF,
    stale: false,
  };
}

function derive(journals: Journal[], prices: ResolvedPrice[], accounts = ACCOUNTS) {
  return derivePortfolioSnapshot({
    householdId: "hh-1",
    reportingCurrency: "CAD",
    reportingMinorUnits: 2,
    accounts,
    journals,
    prices,
  });
}

function positionFor(
  snapshot: ReturnType<typeof derive>,
  key: string,
) {
  const row = snapshot.positions.find((position) => position.key === key);
  if (!row) throw new Error(`no position ${key}`);
  return row;
}

describe("position valuation", () => {
  it("values a priced holding and states its gross and net return", () => {
    const snapshot = derive(BASE_JOURNALS, [quote("XEQT", 3_000n)]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.priceSource).toBe("QUOTE");
    expect(xeqt.priceMinor).toBe("3000");
    expect(xeqt.priceAsOf).toBe(AS_OF);
    expect(xeqt.priceIsStale).toBe(false);

    // 150 units x 30.00 = 4,500.00
    expect(xeqt.marketValueTradeMinor).toBe("450000");
    expect(xeqt.marketValueMinor).toBe("450000");
    expect(xeqt.unrealizedGainMinor).toBe("50000");
    expect(xeqt.grossReturnBps).toBe(1250);

    // The whole 100.00 charge lands on the only cost-bearing holding.
    expect(xeqt.interestCostMinor).toBe("10000");
    expect(xeqt.feeCostMinor).toBe("0");
    expect(xeqt.netReturnBps).toBe(1000);

    expect(xeqt.valuationIsUncertain).toBe(false);
    expect(xeqt.valuationUncertaintyReasons).toEqual([]);
  });

  it("aggregates the same figures across the portfolio", () => {
    const { valuation } = derive(BASE_JOURNALS, [quote("XEQT", 3_000n)]);

    expect(valuation.marketValueMinor).toBe("450000");
    expect(valuation.costBasisMinor).toBe("400000");
    expect(valuation.unrealizedGainMinor).toBe("50000");
    expect(valuation.grossReturnBps).toBe(1250);
    expect(valuation.interestCostMinor).toBe("10000");
    expect(valuation.feeCostMinor).toBe("0");
    expect(valuation.netReturnBps).toBe(1000);
    expect(valuation.pricedAsOf).toBe(AS_OF);
    expect(valuation.hasStalePrice).toBe(false);
    expect(valuation.isUncertain).toBe(false);
    expect(valuation.uncertaintyReasons).toEqual([]);
  });

  it("states a loss as a negative return rather than dropping the sign", () => {
    // 150 x 20.00 = 3,000.00 against a 4,000.00 basis: -1,000.00.
    // gross = -100000 * 10000 / 400000 = -2500 bps
    // net   = (-100000 - 10000) * 10000 / 400000 = -2750 bps
    const xeqt = positionFor(
      derive(BASE_JOURNALS, [quote("XEQT", 2_000n)]),
      "brokerage:XEQT",
    );

    expect(xeqt.unrealizedGainMinor).toBe("-100000");
    expect(xeqt.grossReturnBps).toBe(-2500);
    expect(xeqt.netReturnBps).toBe(-2750);
  });

  it("subtracts fees attributed to a holding from its net return", () => {
    // A 20.00 fee posted against the holding itself.
    // net = (50000 - 10000 - 2000) * 10000 / 400000 = 950 bps
    const fee: Journal = {
      id: "j-fee-xeqt",
      type: "FEE",
      tradeDate: "2024-03-02",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", -2_000n),
          securityId: "XEQT",
        },
        { accountId: "world", amount: money("CAD", 2_000n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, fee], [quote("XEQT", 3_000n)]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.feeCostMinor).toBe("2000");
    expect(xeqt.netReturnBps).toBe(950);
    // Gross is before every cost, so it is unmoved by the fee.
    expect(xeqt.grossReturnBps).toBe(1250);
    expect(snapshot.valuation.feeCostMinor).toBe("2000");
    expect(snapshot.valuation.netReturnBps).toBe(950);
  });

  it("keeps a portfolio-level fee out of a holding's net return and says so", () => {
    // An investment-account fee names no security, so no holding can honestly
    // carry it — but it is unmistakably a cost of the investment programme.
    const fee: Journal = {
      id: "j-fee-account",
      type: "FEE",
      tradeDate: "2024-03-02",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "brokerage", amount: money("CAD", -5_000n) },
        { accountId: "world", amount: money("CAD", 5_000n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, fee], [quote("XEQT", 3_000n)]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.feeCostMinor).toBe("0");
    expect(xeqt.valuationIsUncertain).toBe(true);
    expect(xeqt.valuationUncertaintyReasons.join(" ")).toContain("50.00");

    // The portfolio figure carries every investment fee, so the headline stays
    // complete: (50000 - 10000 - 5000) * 10000 / 400000 = 875 bps
    expect(snapshot.valuation.feeCostMinor).toBe("5000");
    expect(snapshot.valuation.netReturnBps).toBe(875);
  });

  it("does not treat a banking fee as a cost of the investment programme", () => {
    // A chequing maintenance fee is a real cost and an honest ledger entry,
    // but subtracting it from the portfolio return would understate how the
    // investments themselves did.
    const fee: Journal = {
      id: "j-fee-chequing",
      type: "FEE",
      tradeDate: "2024-03-02",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "chequing", amount: money("CAD", -5_000n) },
        { accountId: "world", amount: money("CAD", 5_000n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, fee], [quote("XEQT", 3_000n)]);

    expect(snapshot.valuation.feeCostMinor).toBe("0");
    expect(snapshot.valuation.netReturnBps).toBe(1000);
    // Nothing was excluded from the holding either, so nothing to explain.
    expect(positionFor(snapshot, "brokerage:XEQT").valuationIsUncertain).toBe(false);
  });

  it("does not read a fee rebate as a second fee", () => {
    // Money coming back: the negative leg is the counterparty's, and counting
    // it would turn a refund into a cost.
    const rebate: Journal = {
      id: "j-fee-rebate",
      type: "FEE",
      tradeDate: "2024-03-02",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "brokerage", amount: money("CAD", 2_000n) },
        { accountId: "world", amount: money("CAD", -2_000n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, rebate], [quote("XEQT", 3_000n)]);

    expect(snapshot.valuation.feeCostMinor).toBe("0");
    expect(snapshot.valuation.netReturnBps).toBe(1000);
  });
});

describe("valuation uncertainty", () => {
  it("derives nothing from a holding with no price", () => {
    const snapshot = derive(BASE_JOURNALS, [noPrice("XEQT")]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.priceSource).toBe("NONE");
    expect(xeqt.priceMinor).toBeNull();
    expect(xeqt.priceAsOf).toBeNull();
    expect(xeqt.marketValueTradeMinor).toBeNull();
    expect(xeqt.marketValueMinor).toBeNull();
    expect(xeqt.unrealizedGainMinor).toBeNull();
    expect(xeqt.grossReturnBps).toBeNull();
    expect(xeqt.netReturnBps).toBeNull();
    expect(xeqt.valuationIsUncertain).toBe(true);
    expect(xeqt.valuationUncertaintyReasons.join(" ")).toContain("No price");

    // A total that silently omitted the holding would understate the portfolio.
    expect(snapshot.valuation.marketValueMinor).toBeNull();
    expect(snapshot.valuation.unrealizedGainMinor).toBeNull();
    expect(snapshot.valuation.grossReturnBps).toBeNull();
    expect(snapshot.valuation.netReturnBps).toBeNull();
    expect(snapshot.valuation.isUncertain).toBe(true);
    expect(snapshot.valuation.uncertaintyReasons.join(" ")).toContain("XEQT");
  });

  it("treats a missing price entry exactly as a resolved no-price", () => {
    const xeqt = positionFor(derive(BASE_JOURNALS, []), "brokerage:XEQT");

    expect(xeqt.priceSource).toBe("NONE");
    expect(xeqt.marketValueMinor).toBeNull();
    expect(xeqt.netReturnBps).toBeNull();
    expect(xeqt.valuationIsUncertain).toBe(true);
  });

  it("refuses a negative price rather than deriving a negative market value", () => {
    const snapshot = derive(BASE_JOURNALS, [quote("XEQT", -3_000n)]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.priceSource).toBe("NONE");
    expect(xeqt.marketValueTradeMinor).toBeNull();
    expect(xeqt.marketValueMinor).toBeNull();
    expect(xeqt.netReturnBps).toBeNull();
    expect(xeqt.valuationUncertaintyReasons.join(" ")).toContain("negative");
  });

  it("carries a stale price through to every figure derived from it", () => {
    // A stale price is not a wrong price: the figures are real, and they are
    // as of the price's own date, which is carried rather than relabelled.
    const snapshot = derive(BASE_JOURNALS, [
      quote("XEQT", 3_000n, { asOf: "2024-02-28", stale: true }),
    ]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.priceAsOf).toBe("2024-02-28");
    expect(xeqt.priceIsStale).toBe(true);
    expect(xeqt.marketValueMinor).toBe("450000");
    expect(xeqt.netReturnBps).toBe(1000);
    expect(xeqt.valuationIsUncertain).toBe(true);
    expect(xeqt.valuationUncertaintyReasons.join(" ")).toContain("2024-02-28");

    expect(snapshot.valuation.hasStalePrice).toBe(true);
    expect(snapshot.valuation.isUncertain).toBe(true);
    expect(snapshot.valuation.netReturnBps).toBe(1000);

    // Stale is not incomplete. Every weekend every holding is marked at
    // Friday's close; the portfolio figures are whole, just not current, and
    // the two claims must not share a channel.
    expect(snapshot.valuation.uncertaintyReasons).toEqual([]);
    expect(snapshot.valuation.staleReasons).toHaveLength(1);
    expect(snapshot.valuation.staleReasons[0]).toContain("2024-02-28");
  });

  it("values a holding with an unknown cost basis but states no return on it", () => {
    // A legacy lot opened with no cost: quantity is real, basis is not.
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

    const snapshot = derive(
      [openingUnknownCost, ...BASE_JOURNALS],
      [quote("XEQT", 3_000n), quote("AAPL", 20_000n)],
    );
    const aapl = positionFor(snapshot, "brokerage:AAPL");

    expect(aapl.costIsUnknown).toBe(true);
    // 10 x 200.00 — the market value is knowable even when the basis is not.
    expect(aapl.marketValueMinor).toBe("200000");
    expect(aapl.unrealizedGainMinor).toBeNull();
    expect(aapl.grossReturnBps).toBeNull();
    expect(aapl.netReturnBps).toBeNull();
    expect(aapl.valuationUncertaintyReasons.join(" ")).toContain("cost basis");

    // The portfolio return would be a fiction with one basis missing.
    expect(snapshot.valuation.grossReturnBps).toBeNull();
    expect(snapshot.valuation.netReturnBps).toBeNull();
    expect(snapshot.valuation.uncertaintyReasons.join(" ")).toContain("AAPL");
  });

  it("will not state a reporting-currency value with no rate for the price's currency", () => {
    // Bought in USD, cost recorded in CAD by the journal; the mark comes back
    // in USD and nothing in this ledger converts it.
    const buyUsd: Journal = {
      id: "j-buy-msft",
      type: "BUY",
      tradeDate: "2024-02-05",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", 130_000n),
          quantity: qtyFromDecimalString("10"),
          securityId: "MSFT",
          tradeCurrency: "USD",
          tradeAmountMinor: 100_000n,
        },
        { accountId: "chequing", amount: money("CAD", -130_000n) },
      ],
    };

    const snapshot = derive(
      [deposit, buyOne, buyUsd],
      [quote("XEQT", 3_000n), quote("MSFT", 15_000n, { currency: "USD" })],
    );
    const msft = positionFor(snapshot, "brokerage:MSFT");

    expect(msft.tradeCurrency).toBe("USD");
    expect(msft.priceCurrency).toBe("USD");
    // 10 x 150.00 USD is knowable; what it is worth in CAD is not.
    expect(msft.marketValueTradeMinor).toBe("150000");
    expect(msft.marketValueMinor).toBeNull();
    expect(msft.unrealizedGainMinor).toBeNull();
    expect(msft.grossReturnBps).toBeNull();
    expect(msft.netReturnBps).toBeNull();
    expect(msft.valuationUncertaintyReasons.join(" ")).toContain("no rate");

    expect(snapshot.valuation.marketValueMinor).toBeNull();
    expect(snapshot.valuation.netReturnBps).toBeNull();
    expect(snapshot.valuation.uncertaintyReasons.join(" ")).toContain("MSFT");
  });

  it("states no net return when an interest charge carries no use attribution", () => {
    const unattributed: Journal = {
      id: "j-interest-cash",
      type: "INTEREST_CHARGED",
      tradeDate: "2024-03-10",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "chequing", amount: money("CAD", -800n) },
        { accountId: "world", amount: money("CAD", 800n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, unattributed], [quote("XEQT", 3_000n)]);
    const xeqt = positionFor(snapshot, "brokerage:XEQT");

    expect(xeqt.interestCostMinor).toBeNull();
    expect(xeqt.netReturnBps).toBeNull();
    // Gross is before financing, so it survives an unknowable financing cost.
    expect(xeqt.grossReturnBps).toBe(1250);
    expect(xeqt.valuationUncertaintyReasons.join(" ")).toContain("j-interest-cash");

    expect(snapshot.valuation.interestCostMinor).toBeNull();
    expect(snapshot.valuation.netReturnBps).toBeNull();
    expect(snapshot.valuation.grossReturnBps).toBe(1250);
  });

  it("states no return on a holding whose cost is known to be zero", () => {
    // A BUY, not an OPENING: both amounts zero on an OPENING is how the
    // ledger records an *unknown* cost, so a genuinely free holding has to be
    // recorded as an acquisition that really did cost nothing.
    const gift: Journal = {
      id: "j-gift",
      type: "BUY",
      tradeDate: "2024-01-03",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", 0n),
          quantity: qtyFromDecimalString("5"),
          securityId: "GIFT",
          tradeCurrency: "CAD",
          tradeAmountMinor: 0n,
        },
        { accountId: "world", amount: money("CAD", 0n) },
      ],
    };

    const snapshot = derive([...BASE_JOURNALS, gift], [
      quote("XEQT", 3_000n),
      quote("GIFT", 1_000n),
    ]);
    const row = positionFor(snapshot, "brokerage:GIFT");

    expect(row.costIsUnknown).toBe(false);
    expect(row.marketValueMinor).toBe("5000");
    expect(row.unrealizedGainMinor).toBe("5000");
    // No basis to divide by: a return on nothing is not infinite, it is
    // undefined.
    expect(row.grossReturnBps).toBeNull();
    expect(row.netReturnBps).toBeNull();
    expect(row.valuationUncertaintyReasons.join(" ")).toContain("zero");

    // The portfolio has a real basis, so its return survives: the gift's
    // 50.00 of value is all gain.
    // (50000 + 5000 - 10000) * 10000 / 400000 = 1125 bps
    expect(snapshot.valuation.marketValueMinor).toBe("455000");
    expect(snapshot.valuation.unrealizedGainMinor).toBe("55000");
    expect(snapshot.valuation.netReturnBps).toBe(1125);
  });

  it("says why the portfolio return is null when every holding is zero-cost", () => {
    // A household whose only holding is a gift. Both returns are null because
    // there is nothing to divide by — and with no *other* holding to carry the
    // explanation, the portfolio has to state it itself or the dashboard shows
    // an unexplained blank.
    const gift: Journal = {
      id: "j-gift-only",
      type: "BUY",
      tradeDate: "2024-01-03",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", 0n),
          quantity: qtyFromDecimalString("5"),
          securityId: "GIFT",
          tradeCurrency: "CAD",
          tradeAmountMinor: 0n,
        },
        { accountId: "world", amount: money("CAD", 0n) },
      ],
    };

    const { valuation } = derive([deposit, gift], [quote("GIFT", 1_000n)]);

    expect(valuation.marketValueMinor).toBe("5000");
    expect(valuation.costBasisMinor).toBe("0");
    expect(valuation.unrealizedGainMinor).toBe("5000");
    expect(valuation.grossReturnBps).toBeNull();
    expect(valuation.netReturnBps).toBeNull();
    expect(valuation.isUncertain).toBe(true);
    expect(valuation.uncertaintyReasons.join(" ")).toContain("no basis");
  });
});

describe("valuation with nothing to value", () => {
  it("reports no market value and no return when there are no holdings", () => {
    const { valuation } = derive([deposit], []);

    expect(valuation.marketValueMinor).toBe("0");
    expect(valuation.costBasisMinor).toBe("0");
    expect(valuation.unrealizedGainMinor).toBe("0");
    expect(valuation.grossReturnBps).toBeNull();
    expect(valuation.netReturnBps).toBeNull();
    expect(valuation.uncertaintyReasons.join(" ")).toContain("no holdings");
  });

  it("gives the empty snapshot an empty valuation rather than zeros", () => {
    const { valuation } = emptyPortfolioSnapshot();

    expect(valuation.marketValueMinor).toBeNull();
    expect(valuation.grossReturnBps).toBeNull();
    expect(valuation.netReturnBps).toBeNull();
    expect(valuation.isUncertain).toBe(false);
  });
});

describe("heldSecurityIds", () => {
  it("lists the securities still held, so no price is fetched for a closed holding", () => {
    const sellAll: Journal = {
      id: "j-sell-all",
      type: "SELL",
      tradeDate: "2024-03-20",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        {
          accountId: "brokerage",
          amount: money("CAD", -400_000n),
          quantity: qtyFromDecimalString("-150"),
          securityId: "XEQT",
          tradeCurrency: "CAD",
          tradeAmountMinor: -400_000n,
        },
        { accountId: "chequing", amount: money("CAD", 400_000n) },
      ],
    };

    expect(heldSecurityIds(BASE_JOURNALS)).toEqual(["XEQT"]);
    expect(heldSecurityIds([...BASE_JOURNALS, sellAll])).toEqual([]);
    expect(heldSecurityIds([deposit])).toEqual([]);
  });
});
