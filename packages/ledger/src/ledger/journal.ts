import { ValidationError } from "./errors.js";
import type { Account, AccountId, Journal } from "./types.js";

export function assertJournalBalanced(journal: Journal): void {
  if (journal.postings.length < 2) {
    throw new ValidationError(
      "Journal must have at least 2 postings",
      "UNBALANCED",
      [journal.id],
    );
  }

  let sum = 0n;
  let currency: string | undefined;

  for (const posting of journal.postings) {
    if (currency === undefined) {
      currency = posting.amount.currency;
    } else if (posting.amount.currency !== currency) {
      throw new ValidationError(
        "All postings must use the same reporting currency",
        "CURRENCY",
        [journal.id],
      );
    }
    sum += posting.amount.minor;
  }

  if (sum !== 0n) {
    throw new ValidationError(
      "Journal postings do not sum to zero",
      "UNBALANCED",
      [journal.id],
    );
  }
}

export function assertKnownAccounts(
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
): void {
  for (const posting of journal.postings) {
    if (!accounts.has(posting.accountId)) {
      throw new ValidationError(
        `Unknown account: ${posting.accountId}`,
        "UNKNOWN_ACCOUNT",
        [journal.id],
      );
    }
  }
}

export function assertFacilityUseComplete(
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
): void {
  let drawAmount = 0n;
  let currency: string | undefined;

  for (const posting of journal.postings) {
    const account = accounts.get(posting.accountId);
    if (account?.type === "CREDIT_FACILITY" && posting.amount.minor < 0n) {
      if (currency === undefined) {
        currency = posting.amount.currency;
      }
      drawAmount += -posting.amount.minor;
    }
  }

  if (drawAmount === 0n) {
    return;
  }

  if (!journal.facilityUses || journal.facilityUses.length === 0) {
    throw new ValidationError(
      "Facility draw requires facilityUses",
      "FACILITY_USE",
      [journal.id],
    );
  }

  let useSum = 0n;
  for (const line of journal.facilityUses) {
    if (line.amount.currency !== currency) {
      throw new ValidationError(
        "Facility use currency must match draw currency",
        "CURRENCY",
        [journal.id],
      );
    }
    useSum += line.amount.minor;
  }

  if (useSum !== drawAmount) {
    throw new ValidationError(
      "Facility uses must sum to draw amount",
      "FACILITY_USE",
      [journal.id],
    );
  }
}
