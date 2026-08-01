import type { Journal } from "../ledger/types.js";

export type Statement = {
  id: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  statedBalanceMinor: bigint;
  statedAsOf: string;
  sourceLabel: string;
};

export type ImportCandidate = {
  id: string;
  externalNaturalKey: string;
  tradeDate: string;
  proposedJournal: Journal;
};

export type MatchState = "NEW" | "DUPLICATE" | "CONFLICT";

export type MatchedImportCandidate = ImportCandidate & {
  matchState: MatchState;
  matchedJournalId?: string;
};

export type ReconciliationResult = {
  statementId: string;
  computedBalanceMinor: bigint;
  statedBalanceMinor: bigint;
  status: "MATCH" | "MISMATCH";
};
