import { add, money, type Money } from "../money/money.js";
import type { Quantity } from "../money/quantity.js";
import {
  assertFacilityUseComplete,
  assertJournalBalanced,
  assertKnownAccounts,
} from "./journal.js";
import { applyPostingQuantities } from "./positions-qty.js";
import {
  applyPositionsForJournal,
  emptyPositionState,
  type CostBasisMethod,
  type Position,
  type RealizedGain,
} from "./positions.js";
import type { Account, AccountId, Journal } from "./types.js";

export type ReplayOptions = {
  costBasisMethod?: CostBasisMethod;
};

export type LedgerState = {
  balances: Map<AccountId, Money>;
  quantities: Map<string, Quantity>;
  positions: Map<string, Position>;
  realized: RealizedGain[];
  ledgerVersion: number;
};

export function emptyLedgerState(_reportingCurrency: string): LedgerState {
  const positionState = emptyPositionState();
  return {
    balances: new Map(),
    quantities: new Map(),
    positions: positionState.positions,
    realized: positionState.realized,
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
  options?: ReplayOptions,
): LedgerState {
  assertJournalBalanced(journal);
  assertKnownAccounts(journal, accounts);
  assertFacilityUseComplete(journal, accounts);

  const balances = new Map(state.balances);

  for (const posting of journal.postings) {
    const current = balances.get(posting.accountId) ?? money(posting.amount.currency, 0n);
    balances.set(posting.accountId, add(current, posting.amount));
  }

  const quantities = applyPostingQuantities(
    state.quantities,
    journal.postings,
    journal.id,
  );

  const method = options?.costBasisMethod ?? "ACB";
  const positionState = applyPositionsForJournal(
    { positions: state.positions, realized: state.realized },
    journal,
    method,
  );

  return {
    balances,
    quantities,
    positions: positionState.positions,
    realized: positionState.realized,
    ledgerVersion: state.ledgerVersion + 1,
  };
}

export function replay(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  reportingCurrency: string,
  options?: ReplayOptions,
): LedgerState {
  let state = emptyLedgerState(reportingCurrency);

  for (const journal of sortJournals(journals)) {
    state = applyJournal(state, journal, accounts, options);
  }

  return state;
}
