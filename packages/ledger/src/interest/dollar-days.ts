import { allocateExact } from "../money/rationals.js";
import { positionKey } from "../ledger/positions-qty.js";
import {
  applyPositionsForJournal,
  emptyPositionState,
  type CostBasisMethod,
  type Position,
} from "../ledger/positions.js";
import { sortJournals } from "../ledger/replay.js";
import type { Account, AccountId, Journal } from "../ledger/types.js";
import { addCalendarDays, compareDates } from "./day-count.js";

export type PositionDollarDays = {
  accountId: string;
  securityId: string;
  dollarDaysReporting: bigint;
};

export type InvestmentInterestAllocation = {
  accountId: string;
  securityId: string;
  interestMinor: bigint;
  dollarDaysReporting: bigint;
  sourceJournalIds: string[];
};

export function attributeInvestmentInterest(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<AccountId, Account>;
  periodStart: string;
  periodEnd: string;
  investmentInterestMinor: bigint;
  costBasisMethod?: CostBasisMethod;
}): {
  allocations: InvestmentInterestAllocation[];
  unallocatedMinor: bigint;
} {
  const {
    journals,
    periodStart,
    periodEnd,
    investmentInterestMinor,
    costBasisMethod = "ACB",
  } = args;

  if (periodEnd <= periodStart) {
    throw new Error("periodEnd must be after periodStart");
  }

  const sorted = sortJournals(journals);
  const dollarDaysByKey = new Map<string, PositionDollarDays>();
  const journalIdsByKey = new Map<string, Set<string>>();

  let day = periodStart;
  while (compareDates(day, periodEnd) < 0) {
    const state = replayPositionsAsOf(sorted, day, costBasisMethod);

    for (const [key, position] of state.positions) {
      const closingCost = position.acbCostReportingMinor;
      if (closingCost === 0n) {
        continue;
      }

      const existing = dollarDaysByKey.get(key);
      if (existing === undefined) {
        dollarDaysByKey.set(key, {
          accountId: position.accountId,
          securityId: position.securityId,
          dollarDaysReporting: closingCost,
        });
        journalIdsByKey.set(key, new Set());
      } else {
        existing.dollarDaysReporting += closingCost;
      }
    }

    for (const journal of sorted) {
      if (journal.tradeDate !== day) {
        continue;
      }
      for (const posting of journal.postings) {
        if (posting.securityId === undefined) {
          continue;
        }
        const key = positionKey(posting.accountId, posting.securityId);
        if (state.positions.has(key)) {
          let ids = journalIdsByKey.get(key);
          if (ids === undefined) {
            ids = new Set();
            journalIdsByKey.set(key, ids);
          }
          ids.add(journal.id);
        }
      }
    }

    day = addCalendarDays(day, 1);
  }

  const entries = [...dollarDaysByKey.values()];
  const weights = entries.map((e) => e.dollarDaysReporting);
  const totalDollarDays = weights.reduce((sum, w) => sum + w, 0n);

  if (totalDollarDays === 0n) {
    return { allocations: [], unallocatedMinor: investmentInterestMinor };
  }

  const interestParts = allocateExact(investmentInterestMinor, weights);

  const allocations: InvestmentInterestAllocation[] = entries.map((entry, i) => {
    const key = positionKey(entry.accountId, entry.securityId);
    return {
      accountId: entry.accountId,
      securityId: entry.securityId,
      interestMinor: interestParts[i]!,
      dollarDaysReporting: entry.dollarDaysReporting,
      sourceJournalIds: [...(journalIdsByKey.get(key) ?? [])],
    };
  });

  const allocated = interestParts.reduce((sum, p) => sum + p, 0n);
  const unallocatedMinor = investmentInterestMinor - allocated;

  return { allocations, unallocatedMinor };
}

function replayPositionsAsOf(
  sortedJournals: readonly Journal[],
  asOfDate: string,
  method: CostBasisMethod,
): { positions: Map<string, Position> } {
  let state = emptyPositionState();

  for (const journal of sortedJournals) {
    if (compareDates(journal.tradeDate, asOfDate) > 0) {
      break;
    }
    state = applyPositionsForJournal(state, journal, method);
  }

  return { positions: state.positions };
}
