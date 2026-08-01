import { describe, it, expect } from "vitest";
import { CAD, money } from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";
import { ValidationError } from "../src/ledger/errors.js";
import { assertJournalBalanced, assertFacilityUseComplete } from "../src/ledger/journal.js";

const accounts = new Map<string, Account>([
  ["ext", { id: "ext", type: "EXTERNAL", currency: "CAD" }],
  ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
  ["facility", { id: "facility", type: "CREDIT_FACILITY", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
]);

function baseJournal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: "j1",
    type: "DEPOSIT",
    tradeDate: "2026-01-15",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [],
    ...overrides,
  };
}

describe("assertJournalBalanced", () => {
  it("accepts a balanced deposit EXTERNAL→CASH", () => {
    const journal = baseJournal({
      postings: [
        { accountId: "ext", amount: money(CAD, -10000n) },
        { accountId: "cash", amount: money(CAD, 10000n) },
      ],
    });
    expect(() => assertJournalBalanced(journal)).not.toThrow();
  });

  it("rejects an unbalanced journal", () => {
    const journal = baseJournal({
      postings: [
        { accountId: "ext", amount: money(CAD, -10000n) },
        { accountId: "cash", amount: money(CAD, 9000n) },
      ],
    });
    expect(() => assertJournalBalanced(journal)).toThrow(ValidationError);
    expect(() => assertJournalBalanced(journal)).toThrow(/unbalanced|sum/i);
  });

  it("rejects a single posting", () => {
    const journal = baseJournal({
      postings: [{ accountId: "cash", amount: money(CAD, 10000n) }],
    });
    expect(() => assertJournalBalanced(journal)).toThrow(ValidationError);
  });
});

describe("assertFacilityUseComplete", () => {
  it("rejects a facility draw without facilityUses", () => {
    const journal = baseJournal({
      type: "TRANSFER",
      postings: [
        { accountId: "facility", amount: money(CAD, -50000n) },
        { accountId: "investment", amount: money(CAD, 50000n) },
      ],
    });
    assertJournalBalanced(journal);
    expect(() => assertFacilityUseComplete(journal, accounts)).toThrow(ValidationError);
    expect(() => assertFacilityUseComplete(journal, accounts)).toThrow(/facility/i);
  });

  it("accepts a facility draw with full facilityUses coverage", () => {
    const journal = baseJournal({
      type: "TRANSFER",
      postings: [
        { accountId: "facility", amount: money(CAD, -50000n) },
        { accountId: "investment", amount: money(CAD, 50000n) },
      ],
      facilityUses: [{ use: "INVESTMENT", amount: money(CAD, 50000n) }],
    });
    assertJournalBalanced(journal);
    expect(() => assertFacilityUseComplete(journal, accounts)).not.toThrow();
  });
});
