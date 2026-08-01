import { qtyAdd, type Quantity } from "../money/quantity.js";
import { ValidationError } from "./errors.js";
import type { AccountId, JournalId, Posting, SecurityId } from "./types.js";

export function positionKey(accountId: AccountId, securityId: SecurityId): string {
  return `${accountId}:${securityId}`;
}

export function applyPostingQuantities(
  quantities: ReadonlyMap<string, Quantity>,
  postings: readonly Posting[],
  journalId: JournalId,
): Map<string, Quantity> {
  const next = new Map(quantities);

  for (const posting of postings) {
    if (posting.securityId === undefined || posting.quantity === undefined) {
      continue;
    }

    const key = positionKey(posting.accountId, posting.securityId);
    const current = next.get(key) ?? { scaled: 0n };
    const updated = qtyAdd(current, posting.quantity);

    if (updated.scaled < 0n) {
      throw new ValidationError(
        `Negative quantity for ${key}`,
        "NEGATIVE_QUANTITY",
        [journalId],
      );
    }

    if (updated.scaled === 0n) {
      next.delete(key);
    } else {
      next.set(key, updated);
    }
  }

  return next;
}
