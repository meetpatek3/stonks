import { sortJournals } from "../ledger/replay.js";
import type { Account, AccountId, Journal } from "../ledger/types.js";
import type { InterestModelResult, InterestVariance } from "./types.js";

export function actualInterestCharged(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<AccountId, Account>;
  facilityAccountId: AccountId;
  periodStart: string;
  periodEnd: string;
}): { actualPostedMinor: bigint; actualJournalIds: string[] } {
  const { journals, facilityAccountId, periodStart, periodEnd } = args;
  let actualPostedMinor = 0n;
  const actualJournalIds: string[] = [];

  for (const journal of sortJournals(journals)) {
    if (journal.type !== "INTEREST_CHARGED") continue;
    if (journal.tradeDate < periodStart || journal.tradeDate >= periodEnd) {
      continue;
    }

    let facilityDelta = 0n;
    for (const posting of journal.postings) {
      if (posting.accountId === facilityAccountId) {
        facilityDelta += posting.amount.minor;
      }
    }

    // Liability increase (capitalize) is negative posting → positive charged amount
    if (facilityDelta < 0n) {
      actualPostedMinor += -facilityDelta;
      actualJournalIds.push(journal.id);
    } else if (facilityDelta === 0n) {
      // Pay-separately: expense hits EXTERNAL/CASH; still count absolute interest expense
      // Prefer facility leg when present; if none, sum positive expense-like postings? 
      // For pay-separately, INTEREST_CHARGED typically: expense (+), cash/external (-)
      // Count the positive posting sum as actual charged.
      let positive = 0n;
      for (const posting of journal.postings) {
        if (posting.amount.minor > 0n) positive += posting.amount.minor;
      }
      actualPostedMinor += positive;
      actualJournalIds.push(journal.id);
    }
  }

  return { actualPostedMinor, actualJournalIds };
}

export function interestVariance(
  model: InterestModelResult,
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
): InterestVariance {
  const actual = actualInterestCharged({
    journals,
    accounts,
    facilityAccountId: model.facilityAccountId,
    periodStart: model.periodStart,
    periodEnd: model.periodEnd,
  });

  return {
    facilityAccountId: model.facilityAccountId,
    periodStart: model.periodStart,
    periodEnd: model.periodEnd,
    modelledTotalMinor: model.modelledTotalMinor,
    modelledByUse: model.modelledByUse,
    actualPostedMinor: actual.actualPostedMinor,
    varianceMinor: model.modelledTotalMinor - actual.actualPostedMinor,
    actualJournalIds: actual.actualJournalIds,
  };
}
