import { describe, it, expect } from "vitest";
import depositTransferFixture from "../../../fixtures/ledger/deposit-transfer.json" with { type: "json" };
import { CAD, money } from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";
import {
  emptyLedgerState,
  sortJournals,
  applyJournal,
  replay,
} from "../src/ledger/replay.js";
import { ValidationError } from "../src/ledger/errors.js";

type FixtureMoney = { currency: string; minor: string };
type Fixture = {
  reportingCurrency: string;
  accounts: Account[];
  journals: Array<Omit<Journal, "postings"> & { postings: Array<{ accountId: string; amount: FixtureMoney }> }>;
  expected: {
    ledgerVersion: number;
    balances: Record<string, FixtureMoney>;
  };
};

function loadFixture(): {
  reportingCurrency: string;
  accounts: Map<string, Account>;
  journals: Journal[];
  expected: Fixture["expected"];
} {
  const raw = depositTransferFixture as Fixture;
  const accounts = new Map(raw.accounts.map((a) => [a.id, a]));
  const journals: Journal[] = raw.journals.map((j) => ({
    ...j,
    postings: j.postings.map((p) => ({
      accountId: p.accountId,
      amount: money(p.amount.currency, BigInt(p.amount.minor)),
    })),
  }));
  return { reportingCurrency: raw.reportingCurrency, accounts, journals, expected: raw.expected };
}

describe("sortJournals", () => {
  it("orders by tradeDate, sortKey, id and skips SUPERSEDED", () => {
    const journals: Journal[] = [
      {
        id: "j3",
        type: "TRANSFER",
        tradeDate: "2024-01-02",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [],
      },
      {
        id: "j1",
        type: "DEPOSIT",
        tradeDate: "2024-01-01",
        sortKey: 1,
        status: "POSTED",
        source: "MANUAL",
        postings: [],
      },
      {
        id: "j0",
        type: "DEPOSIT",
        tradeDate: "2024-01-01",
        sortKey: 0,
        status: "POSTED",
        source: "MANUAL",
        postings: [],
      },
      {
        id: "j-old",
        type: "DEPOSIT",
        tradeDate: "2023-12-31",
        sortKey: 0,
        status: "SUPERSEDED",
        source: "MANUAL",
        postings: [],
      },
    ];

    const sorted = sortJournals(journals);
    expect(sorted.map((j) => j.id)).toEqual(["j0", "j1", "j3"]);
  });
});

describe("replay", () => {
  it("replays deposit-transfer fixture into expected balances", () => {
    const { reportingCurrency, accounts, journals, expected } = loadFixture();

    const state = replay(journals, accounts, reportingCurrency);

    expect(state.ledgerVersion).toBe(expected.ledgerVersion);
    for (const [accountId, expectedMoney] of Object.entries(expected.balances)) {
      const balance = state.balances.get(accountId);
      expect(balance).toEqual(money(expectedMoney.currency, BigInt(expectedMoney.minor)));
    }
  });
});

describe("applyJournal", () => {
  it("starts from empty state and accumulates posting amounts", () => {
    const { accounts, journals } = loadFixture();
    let state = emptyLedgerState("CAD");

    state = applyJournal(state, journals[0]!, accounts);
    expect(state.balances.get("cash")).toEqual(money(CAD, 100000n));
    expect(state.balances.get("ext")).toEqual(money(CAD, -100000n));
    expect(state.ledgerVersion).toBe(1);
  });

  it("throws UNKNOWN_ACCOUNT when a posting references a missing account", () => {
    const { journals } = loadFixture();
    const emptyAccounts = new Map<string, Account>();
    const state = emptyLedgerState("CAD");

    expect(() => applyJournal(state, journals[0]!, emptyAccounts)).toThrow(ValidationError);
    try {
      applyJournal(state, journals[0]!, emptyAccounts);
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("UNKNOWN_ACCOUNT");
    }
  });
});
