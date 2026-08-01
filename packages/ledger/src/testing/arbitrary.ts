import fc from "fast-check";
import { CAD } from "../money/currency.js";
import { money } from "../money/money.js";
import { qtyFromDecimalString } from "../money/quantity.js";
import type { Account, Journal } from "../ledger/types.js";
import { sortJournals } from "../ledger/replay.js";

const DEFAULT_ACCOUNTS: Account[] = [
  { id: "ext", type: "EXTERNAL", currency: "CAD" },
  { id: "cash", type: "CASH", currency: "CAD" },
  { id: "investment", type: "INVESTMENT", currency: "CAD" },
];

export function defaultAccountsMap(): Map<string, Account> {
  return new Map(DEFAULT_ACCOUNTS.map((a) => [a.id, a]));
}

const journalIdArb = fc.uuid();
const tradeDateArb = fc
  .integer({ min: 0, max: 365 * 5 })
  .map((offset) => {
    const d = new Date(Date.UTC(2020, 0, 1));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
const amountMinorArb = fc.bigInt({ min: 1n, max: 10_000_00n });

function depositJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
  amount: bigint,
): Journal {
  return {
    id,
    type: "DEPOSIT",
    tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "ext", amount: money(CAD, -amount) },
      { accountId: "cash", amount: money(CAD, amount) },
    ],
  };
}

function transferJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
  amount: bigint,
): Journal {
  return {
    id,
    type: "TRANSFER",
    tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "cash", amount: money(CAD, -amount) },
      { accountId: "investment", amount: money(CAD, amount) },
    ],
  };
}

export type BalancedJournalChain = {
  journals: Journal[];
  accounts: Map<string, Account>;
};

export const balancedJournalChainArb: fc.Arbitrary<BalancedJournalChain> = fc
  .array(
    fc.record({
      kind: fc.constantFrom("DEPOSIT" as const, "TRANSFER" as const),
      amount: amountMinorArb,
      tradeDate: tradeDateArb,
      sortKey: fc.nat({ max: 100 }),
      id: journalIdArb,
    }),
    { minLength: 0, maxLength: 15 },
  )
  .map((entries) => ({
    journals: entries.map((e) =>
      e.kind === "DEPOSIT"
        ? depositJournal(e.id, e.tradeDate, e.sortKey, e.amount)
        : transferJournal(e.id, e.tradeDate, e.sortKey, e.amount),
    ),
    accounts: defaultAccountsMap(),
  }));

const SECURITY = "TEST";

function buyJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
  qtyScaled: bigint,
): Journal {
  const qty = { scaled: qtyScaled };
  const cashMinor = qtyScaled * 100n;
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
        amount: money(CAD, cashMinor),
        quantity: qty,
        securityId: SECURITY,
      },
      { accountId: "cash", amount: money(CAD, -cashMinor) },
    ],
  };
}

function sellJournal(
  id: string,
  tradeDate: string,
  sortKey: number,
  qtyScaled: bigint,
): Journal {
  const qty = { scaled: -qtyScaled };
  const cashMinor = qtyScaled * 100n;
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
        amount: money(CAD, -cashMinor),
        quantity: qty,
        securityId: SECURITY,
      },
      { accountId: "cash", amount: money(CAD, cashMinor) },
    ],
  };
}

function sellFoldsBeforeBuy(journals: Journal[]): boolean {
  const sorted = sortJournals(journals);
  const sellIdx = sorted.findIndex((j) => j.type === "SELL");
  const buyIdx = sorted.findIndex((j) => j.type === "BUY");
  return sellIdx >= 0 && buyIdx >= 0 && sellIdx < buyIdx;
}

export type ConflictingSameDayTrades = {
  journals: Journal[];
  accounts: Map<string, Account>;
  sellFoldsFirst: boolean;
};

export const conflictingSameDayTradesArb: fc.Arbitrary<ConflictingSameDayTrades> =
  fc
    .record({
      tradeDate: tradeDateArb,
      sellSortKey: fc.nat({ max: 100 }),
      buySortKey: fc.nat({ max: 100 }),
      sellId: journalIdArb,
      buyId: journalIdArb,
      qtyWhole: fc.integer({ min: 1, max: 100 }),
    })
    .map(({ tradeDate, sellSortKey, buySortKey, sellId, buyId, qtyWhole }) => {
      const qtyScaled = qtyFromDecimalString(String(qtyWhole)).scaled;
      const journals = [
        sellJournal(sellId, tradeDate, sellSortKey, qtyScaled),
        buyJournal(buyId, tradeDate, buySortKey, qtyScaled),
      ];
      return {
        journals,
        accounts: defaultAccountsMap(),
        sellFoldsFirst: sellFoldsBeforeBuy(journals),
      };
    });

export type BuySellChain = {
  journals: Journal[];
  accounts: Map<string, Account>;
  totalBuyQtyScaled: bigint;
  totalSellQtyScaled: bigint;
  totalBuyCostReporting: bigint;
};

/** Buys then sells that never oversell — safe for both ACB and FIFO. */
export const buySellChainArb: fc.Arbitrary<BuySellChain> = fc
  .record({
    buys: fc.array(
      fc.record({
        id: journalIdArb,
        tradeDate: tradeDateArb,
        qtyWhole: fc.integer({ min: 1, max: 50 }),
        unitPriceMinor: fc.bigInt({ min: 1n, max: 500_00n }),
      }),
      { minLength: 1, maxLength: 6 },
    ),
    sellFractions: fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: 0,
      maxLength: 4,
    }),
  })
  .map(({ buys, sellFractions }) => {
    const buyJournals: Journal[] = [];
    let totalBuyQtyScaled = 0n;
    let totalBuyCostReporting = 0n;
    let day = 0;

    for (const buy of buys) {
      const qtyScaled = qtyFromDecimalString(String(buy.qtyWhole)).scaled;
      const cost = buy.unitPriceMinor * BigInt(buy.qtyWhole);
      totalBuyQtyScaled += qtyScaled;
      totalBuyCostReporting += cost;
      buyJournals.push({
        id: buy.id,
        type: "BUY",
        tradeDate: `2024-01-${String((day % 28) + 1).padStart(2, "0")}`,
        sortKey: day,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, cost),
            quantity: { scaled: qtyScaled },
            securityId: SECURITY,
          },
          { accountId: "cash", amount: money(CAD, -cost) },
        ],
      });
      day += 1;
    }

    const sellJournals: Journal[] = [];
    let remaining = totalBuyQtyScaled;
    let totalSellQtyScaled = 0n;

    for (let i = 0; i < sellFractions.length && remaining > 0n; i += 1) {
      const fraction = sellFractions[i]!;
      let sellScaled = (remaining * BigInt(fraction)) / 100n;
      if (sellScaled === 0n) sellScaled = remaining < 1_00000000n ? remaining : 1_00000000n;
      if (sellScaled > remaining) sellScaled = remaining;

      const proceeds = (sellScaled / 1_00000000n) * 100_00n + 1n;
      sellJournals.push({
        id: `sell-${i}-${buys[0]!.id}`,
        type: "SELL",
        tradeDate: `2024-06-${String((i % 28) + 1).padStart(2, "0")}`,
        sortKey: i,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          {
            accountId: "investment",
            amount: money(CAD, -proceeds),
            quantity: { scaled: -sellScaled },
            securityId: SECURITY,
          },
          { accountId: "cash", amount: money(CAD, proceeds) },
        ],
      });
      remaining -= sellScaled;
      totalSellQtyScaled += sellScaled;
    }

    return {
      journals: [...buyJournals, ...sellJournals],
      accounts: defaultAccountsMap(),
      totalBuyQtyScaled,
      totalSellQtyScaled,
      totalBuyCostReporting,
    };
  });

export function facilityAccountsMap(): Map<string, Account> {
  return new Map([
    ["facility", { id: "facility", type: "CREDIT_FACILITY", currency: "CAD" }],
    ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
    ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
    ["ext", { id: "ext", type: "EXTERNAL", currency: "CAD" }],
  ]);
}

export type FacilityDrawRepayChain = {
  journals: Journal[];
  accounts: Map<string, Account>;
};

/** Draws with facility uses, then smaller proportional repays — never oversell owed. */
export const facilityDrawRepayChainArb: fc.Arbitrary<FacilityDrawRepayChain> = fc
  .record({
    draws: fc.array(
      fc.record({
        id: journalIdArb,
        amount: fc.bigInt({ min: 1_00n, max: 50_000_00n }),
        use: fc.constantFrom(
          "INVESTMENT" as const,
          "LENDING" as const,
          "PERSONAL" as const,
          "OTHER" as const,
        ),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    repayFraction: fc.integer({ min: 0, max: 80 }),
  })
  .map(({ draws, repayFraction }) => {
    const journals: Journal[] = [];
    let day = 1;
    let owed = 0n;

    for (const draw of draws) {
      journals.push({
        id: draw.id,
        type: "TRANSFER",
        tradeDate: `2024-01-${String(day).padStart(2, "0")}`,
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [
          { accountId: "facility", amount: money(CAD, -draw.amount) },
          { accountId: "investment", amount: money(CAD, draw.amount) },
        ],
        facilityUses: [{ use: draw.use, amount: money(CAD, draw.amount) }],
      });
      owed += draw.amount;
      day += 1;
    }

    if (repayFraction > 0 && owed > 0n) {
      const repay = (owed * BigInt(repayFraction)) / 100n;
      if (repay > 0n) {
        journals.push({
          id: `repay-${draws[0]!.id}`,
          type: "TRANSFER",
          tradeDate: `2024-01-${String(Math.min(day, 28)).padStart(2, "0")}`,
          sortKey: 0,
          status: "POSTED",
          source: "MANUAL",
          postings: [
            { accountId: "cash", amount: money(CAD, -repay) },
            { accountId: "facility", amount: money(CAD, repay) },
          ],
        });
      }
    }

    return { journals, accounts: facilityAccountsMap() };
  });
