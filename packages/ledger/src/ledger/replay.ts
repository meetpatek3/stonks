import { add, money, type Money } from "../money/money.js";
import { assertFacilityUseComplete, assertJournalBalanced } from "./journal.js";
import type { Account, AccountId, Journal } from "./types.js";

export type LedgerState = {
  balances: Map<AccountId, Money>;
  ledgerVersion: number;
};

export function emptyLedgerState(_reportingCurrency: string): LedgerState {
  return {
    balances: new Map(),
    ledgerVersion: 0,
  };
}

export function sortJournals(journals: readonly Journal[]): Journal[] {
  return journals
    .filter((journal) => journal.status === "POSTED")
    .sort((a, b) => {
      if (a.tradeDate !== b.tradeDate) {
        return a.tradeDate < b.tradeDate ? -1 : 1;
      }
      if (a.sortKey !== b.sortKey) {
        return a.sortKey - b.sortKey;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

export function applyJournal(
  state: LedgerState,
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
): LedgerState {
  assertJournalBalanced(journal);
  assertFacilityUseComplete(journal, accounts);

  const balances = new Map(state.balances);

  for (const posting of journal.postings) {
    const current = balances.get(posting.accountId) ?? money(posting.amount.currency, 0n);
    balances.set(posting.accountId, add(current, posting.amount));
  }

  return {
    balances,
    ledgerVersion: state.ledgerVersion + 1,
  };
}

export function replay(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  reportingCurrency: string,
): LedgerState {
  let state = emptyLedgerState(reportingCurrency);

  for (const journal of sortJournals(journals)) {
    state = applyJournal(state, journal, accounts);
  }

  return state;
}
