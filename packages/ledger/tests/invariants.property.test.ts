import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { replay, ValidationError } from "../src/index.js";
import {
  balancedJournalChainArb,
  conflictingSameDayTradesArb,
} from "../src/testing/arbitrary.js";
import type { LedgerState } from "../src/ledger/replay.js";

function sumBalanceMinors(state: LedgerState): bigint {
  let sum = 0n;
  for (const bal of state.balances.values()) {
    sum += bal.minor;
  }
  return sum;
}

function statesEqual(a: LedgerState, b: LedgerState): boolean {
  if (a.ledgerVersion !== b.ledgerVersion) return false;
  if (a.balances.size !== b.balances.size) return false;
  for (const [id, bal] of a.balances) {
    const other = b.balances.get(id);
    if (!other || other.minor !== bal.minor || other.currency !== bal.currency) {
      return false;
    }
  }
  if (a.quantities.size !== b.quantities.size) return false;
  for (const [key, qty] of a.quantities) {
    const other = b.quantities.get(key);
    if (!other || other.scaled !== qty.scaled) return false;
  }
  return true;
}

describe("ledger replay invariants", () => {
  it("cash balances never drift from the ledger", () => {
    fc.assert(
      fc.property(balancedJournalChainArb, ({ journals, accounts }) => {
        const state = replay(journals, accounts, "CAD");
        expect(sumBalanceMinors(state)).toBe(0n);
      }),
      { numRuns: 100 },
    );
  });

  it("replaying twice yields identical balances and quantities", () => {
    fc.assert(
      fc.property(balancedJournalChainArb, ({ journals, accounts }) => {
        const first = replay(journals, accounts, "CAD");
        const second = replay(journals, accounts, "CAD");
        expect(statesEqual(first, second)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("same-day conflicting trades reject negative quantity when sell folds before buy", () => {
    fc.assert(
      fc.property(
        conflictingSameDayTradesArb,
        ({ journals, accounts, sellFoldsFirst }) => {
          if (sellFoldsFirst) {
            expect(() => replay(journals, accounts, "CAD")).toThrow(ValidationError);
            try {
              replay(journals, accounts, "CAD");
            } catch (err) {
              expect(err).toBeInstanceOf(ValidationError);
              expect((err as ValidationError).code).toBe("NEGATIVE_QUANTITY");
            }
          } else {
            const state = replay(journals, accounts, "CAD");
            expect(state.quantities.size).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
