/**
 * Pure helpers for the transactions (ledger) grid.
 *
 * Nothing here replays the ledger or invents a balance. Rows are a presentable
 * projection of already-persisted journals: accounts touched, a signed display
 * amount derived from the postings, and the supersession link. Money stays
 * `bigint` until it leaves as a minor-unit string — never `Number(...)`.
 *
 * No React, so this is unit-testable on its own.
 */

import type {
  AccountType,
  Journal,
  JournalStatus,
  JournalType,
} from "@stonks/ledger";

export type AccountRef = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  minorUnits: number;
};

export type JournalRow = {
  id: string;
  tradeDate: string;
  sortKey: number;
  type: JournalType;
  status: JournalStatus;
  /** Id of the journal this one corrects, when present. */
  supersedesJournalId: string | null;
  memo: string | null;
  /** Distinct account ids touched by the journal's postings, in posting order. */
  accountIds: string[];
  /** Display label, account names joined with " · ". */
  accountLabel: string;
  /**
   * Signed minor units of the characteristic leg, in the household reporting
   * currency the repo remaps postings into. `null` only when there are no
   * postings at all — never a substituted `"0"`.
   *
   * Sign convention (inflow positive for the household):
   * 1. Negated sum of EXTERNAL postings, when any exist.
   * 2. Else sum of CASH + CREDIT_FACILITY postings (financing legs).
   * 3. Else half of Σ|amount| as a positive magnitude (neutral internal move).
   */
  signedAmountMinor: string | null;
  currency: string;
  minorUnits: number;
};

export type JournalFilters = {
  type: JournalType | "ALL";
  accountId: string | "ALL";
};

/**
 * Signed display amount for one journal. See `JournalRow.signedAmountMinor`.
 */
export function journalSignedAmountMinor(
  journal: Journal,
  accounts: ReadonlyMap<string, AccountRef>,
): string | null {
  const postings = journal.postings;
  if (postings.length === 0) return null;

  let externalSum = 0n;
  let hasExternal = false;
  let financingSum = 0n;
  let hasFinancing = false;
  let absSum = 0n;

  for (const posting of postings) {
    const minor = posting.amount.minor;
    absSum += minor < 0n ? -minor : minor;

    const type = accounts.get(posting.accountId)?.type;
    if (type === "EXTERNAL") {
      hasExternal = true;
      externalSum += minor;
    } else if (type === "CASH" || type === "CREDIT_FACILITY") {
      hasFinancing = true;
      financingSum += minor;
    }
  }

  if (hasExternal) {
    return (-externalSum).toString();
  }
  if (hasFinancing && financingSum !== 0n) {
    return financingSum.toString();
  }
  return (absSum / 2n).toString();
}

/**
 * Project journals into grid rows. Ordered by `tradeDate` then `sortKey`
 * (the same order replay uses). Superseded journals are kept.
 */
export function toJournalRows(
  journals: readonly Journal[],
  accounts: readonly AccountRef[],
): JournalRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const reporting = accounts.find((a) => a.type !== "EXTERNAL") ?? accounts[0];
  const currency = reporting?.currency ?? "CAD";
  const minorUnits = reporting?.minorUnits ?? 2;

  const rows = journals.map((journal): JournalRow => {
    const accountIds: string[] = [];
    for (const posting of journal.postings) {
      if (!accountIds.includes(posting.accountId)) {
        accountIds.push(posting.accountId);
      }
    }

    const names = accountIds.map(
      (id) => byId.get(id)?.name ?? id,
    );

    return {
      id: journal.id,
      tradeDate: journal.tradeDate,
      sortKey: journal.sortKey,
      type: journal.type,
      status: journal.status,
      supersedesJournalId: journal.supersedesJournalId ?? null,
      memo: journal.memo ?? null,
      accountIds,
      accountLabel: names.join(" · "),
      signedAmountMinor: journalSignedAmountMinor(journal, byId),
      currency,
      minorUnits,
    };
  });

  rows.sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) {
      return a.tradeDate < b.tradeDate ? -1 : 1;
    }
    return a.sortKey - b.sortKey;
  });

  return rows;
}

/** Narrow a journal list by type and/or account touched. */
export function filterJournalRows(
  rows: readonly JournalRow[],
  filters: JournalFilters,
): JournalRow[] {
  return rows.filter((row) => {
    if (filters.type !== "ALL" && row.type !== filters.type) return false;
    if (
      filters.accountId !== "ALL" &&
      !row.accountIds.includes(filters.accountId)
    ) {
      return false;
    }
    return true;
  });
}
