import { describe, expect, it } from "vitest";
import { money, qtyFromDecimalString } from "@stonks/ledger";
import type { Journal } from "@stonks/ledger";
import {
  filterJournalRows,
  journalSignedAmountMinor,
  toJournalRows,
  type AccountRef,
  type JournalRow,
} from "@/lib/ledger-table";

const accounts: AccountRef[] = [
  {
    id: "ext",
    name: "External",
    type: "EXTERNAL",
    currency: "CAD",
    minorUnits: 2,
  },
  {
    id: "cash",
    name: "Chequing",
    type: "CASH",
    currency: "CAD",
    minorUnits: 2,
  },
  {
    id: "inv",
    name: "Brokerage",
    type: "INVESTMENT",
    currency: "CAD",
    minorUnits: 2,
  },
  {
    id: "loan",
    name: "Investment loan",
    type: "CREDIT_FACILITY",
    currency: "CAD",
    minorUnits: 2,
  },
];

describe("journalSignedAmountMinor", () => {
  it("treats negated EXTERNAL postings as household inflow (deposit)", () => {
    // EXTERNAL −1000.00, CASH +1000.00 → inflow +1000.00
    const journal = deposit("j1", 100_000n);
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBe("100000");
  });

  it("treats negated EXTERNAL postings as household outflow (withdrawal)", () => {
    // CASH −250.00, EXTERNAL +250.00 → outflow −250.00
    const journal: Journal = {
      id: "j-wd",
      type: "WITHDRAWAL",
      tradeDate: "2024-01-03",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "cash", amount: money("CAD", -25_000n) },
        { accountId: "ext", amount: money("CAD", 25_000n) },
      ],
    };
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBe("-25000");
  });

  it("uses the cash/facility financing leg when there is no EXTERNAL posting (buy)", () => {
    // CASH −500.00, INVESTMENT +500.00 → signed amount −500.00 (cash out)
    const journal: Journal = {
      id: "j-buy",
      type: "BUY",
      tradeDate: "2024-01-05",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "cash", amount: money("CAD", -50_000n) },
        {
          accountId: "inv",
          amount: money("CAD", 50_000n),
          quantity: qtyFromDecimalString("10"),
          securityId: "XEQT",
        },
      ],
    };
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBe("-50000");
  });

  it("uses facility draw as the financing leg for a leveraged buy", () => {
    // CREDIT_FACILITY +800.00 (drawn), INVESTMENT +800.00 wait — facility
    // liability increases as a negative cash-equivalent: draw is CREDIT_FACILITY
    // posting of −800 (liability up) or +800 depending on sign convention.
    // In this ledger, a facility draw credits the facility (negative balance
    // grows more negative): CREDIT_FACILITY −800, INVESTMENT +800.
    const journal: Journal = {
      id: "j-lev",
      type: "BUY",
      tradeDate: "2024-01-06",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "loan", amount: money("CAD", -80_000n) },
        {
          accountId: "inv",
          amount: money("CAD", 80_000n),
          quantity: qtyFromDecimalString("20"),
          securityId: "VFV",
        },
      ],
    };
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBe("-80000");
  });

  it("falls back to half the L1 of postings when only non-financing legs remain", () => {
    // TRANSFER between two investment sub-positions is rare; model a
    // INVESTMENT↔INVESTMENT move of 100.00 so financing/external sum to 0.
    const journal: Journal = {
      id: "j-move",
      type: "TRANSFER",
      tradeDate: "2024-01-07",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [
        { accountId: "inv", amount: money("CAD", -10_000n) },
        { accountId: "inv", amount: money("CAD", 10_000n) },
      ],
    };
    // Σ|amount| = 20000; half = 10000. Positive magnitude for a neutral move.
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBe("10000");
  });

  it("returns null when a journal has no postings", () => {
    const journal: Journal = {
      id: "j-empty",
      type: "OPENING",
      tradeDate: "2024-01-01",
      sortKey: 0,
      status: "POSTED",
      source: "MANUAL",
      postings: [],
    };
    expect(journalSignedAmountMinor(journal, byId(accounts))).toBeNull();
  });
});

describe("toJournalRows", () => {
  it("maps journals into display rows with accounts touched and supersession", () => {
    const superseded: Journal = {
      id: "j-old",
      type: "DEPOSIT",
      tradeDate: "2024-02-01",
      sortKey: 0,
      status: "SUPERSEDED",
      source: "MANUAL",
      memo: "wrong",
      postings: [
        { accountId: "ext", amount: money("CAD", -50_000n) },
        { accountId: "cash", amount: money("CAD", 50_000n) },
      ],
    };
    const correction: Journal = {
      id: "j-new",
      type: "DEPOSIT",
      tradeDate: "2024-02-01",
      sortKey: 1,
      status: "POSTED",
      source: "MANUAL",
      memo: "fixed",
      supersedesJournalId: "j-old",
      postings: [
        { accountId: "ext", amount: money("CAD", -75_000n) },
        { accountId: "cash", amount: money("CAD", 75_000n) },
      ],
    };

    const rows = toJournalRows([superseded, correction], accounts);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toEqual<JournalRow>({
      id: "j-old",
      tradeDate: "2024-02-01",
      sortKey: 0,
      type: "DEPOSIT",
      status: "SUPERSEDED",
      supersedesJournalId: null,
      memo: "wrong",
      accountIds: ["ext", "cash"],
      accountLabel: "External · Chequing",
      signedAmountMinor: "50000",
      currency: "CAD",
      minorUnits: 2,
    });

    expect(rows[1]).toEqual<JournalRow>({
      id: "j-new",
      tradeDate: "2024-02-01",
      sortKey: 1,
      type: "DEPOSIT",
      status: "POSTED",
      supersedesJournalId: "j-old",
      memo: "fixed",
      accountIds: ["ext", "cash"],
      accountLabel: "External · Chequing",
      signedAmountMinor: "75000",
      currency: "CAD",
      minorUnits: 2,
    });
  });

  it("orders by tradeDate then sortKey ascending (replay order)", () => {
    const a = deposit("a", 1n, "2024-03-02", 0);
    const b = deposit("b", 1n, "2024-03-01", 5);
    const c = deposit("c", 1n, "2024-03-01", 1);
    const rows = toJournalRows([a, b, c], accounts);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps SUPERSEDED journals in the list — never drops them", () => {
    const rows = toJournalRows(
      [
        { ...deposit("posted", 1n), status: "POSTED" },
        { ...deposit("old", 1n), status: "SUPERSEDED" },
      ],
      accounts,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["old", "posted"]);
    expect(rows.find((r) => r.id === "old")?.status).toBe("SUPERSEDED");
  });
});

describe("filterJournalRows", () => {
  const rows: JournalRow[] = [
    row({ id: "1", type: "BUY", accountIds: ["cash", "inv"] }),
    row({ id: "2", type: "DEPOSIT", accountIds: ["ext", "cash"] }),
    row({ id: "3", type: "BUY", accountIds: ["loan", "inv"] }),
  ];

  it("returns every row when both filters are ALL", () => {
    expect(filterJournalRows(rows, { type: "ALL", accountId: "ALL" })).toEqual(rows);
  });

  it("filters by journal type", () => {
    expect(
      filterJournalRows(rows, { type: "BUY", accountId: "ALL" }).map((r) => r.id),
    ).toEqual(["1", "3"]);
  });

  it("filters by account touched", () => {
    expect(
      filterJournalRows(rows, { type: "ALL", accountId: "loan" }).map((r) => r.id),
    ).toEqual(["3"]);
  });

  it("applies type and account together", () => {
    expect(
      filterJournalRows(rows, { type: "BUY", accountId: "cash" }).map((r) => r.id),
    ).toEqual(["1"]);
  });
});

function byId(list: AccountRef[]): Map<string, AccountRef> {
  return new Map(list.map((a) => [a.id, a]));
}

function deposit(
  id: string,
  minor: bigint,
  tradeDate = "2024-01-02",
  sortKey = 0,
): Journal {
  return {
    id,
    type: "DEPOSIT",
    tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "ext", amount: money("CAD", -minor) },
      { accountId: "cash", amount: money("CAD", minor) },
    ],
  };
}

function row(
  overrides: Partial<JournalRow> & Pick<JournalRow, "id" | "type" | "accountIds">,
): JournalRow {
  return {
    tradeDate: "2024-01-01",
    sortKey: 0,
    status: "POSTED",
    supersedesJournalId: null,
    memo: null,
    accountLabel: overrides.accountIds.join(" · "),
    signedAmountMinor: "0",
    currency: "CAD",
    minorUnits: 2,
    ...overrides,
  };
}
