import type { Journal } from "../ledger/types.js";
import type { ImportCandidate, MatchedImportCandidate } from "./types.js";

function postingAmountsKey(journal: Journal): string {
  const amounts = journal.postings.map((p) => ({
    accountId: p.accountId,
    currency: p.amount.currency,
    minor: p.amount.minor.toString(),
  }));
  amounts.sort((a, b) => a.accountId.localeCompare(b.accountId));
  return JSON.stringify(amounts);
}

export function matchImportCandidates(
  candidates: ImportCandidate[],
  existingJournals: Journal[],
): MatchedImportCandidate[] {
  const byKey = new Map<string, Journal>();
  for (const journal of existingJournals) {
    if (journal.externalNaturalKey) {
      byKey.set(journal.externalNaturalKey, journal);
    }
  }

  return candidates.map((candidate) => {
    const existing = byKey.get(candidate.externalNaturalKey);
    if (!existing) {
      return { ...candidate, matchState: "NEW" };
    }

    const candidateKey = postingAmountsKey(candidate.proposedJournal);
    const existingKey = postingAmountsKey(existing);

    if (candidateKey === existingKey) {
      return {
        ...candidate,
        matchState: "DUPLICATE",
        matchedJournalId: existing.id,
      };
    }

    return {
      ...candidate,
      matchState: "CONFLICT",
      matchedJournalId: existing.id,
    };
  });
}
