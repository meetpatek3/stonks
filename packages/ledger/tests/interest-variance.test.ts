import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  modelInterest,
  interestVariance,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const accounts = new Map<string, Account>([
  ["facility", { id: "facility", type: "CREDIT_FACILITY", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
  ["expense", { id: "expense", type: "EXTERNAL", currency: "CAD" }],
]);

const draw: Journal = {
  id: "draw",
  type: "TRANSFER",
  tradeDate: "2024-01-01",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money(CAD, -100000n) },
    { accountId: "investment", amount: money(CAD, 100000n) },
  ],
  facilityUses: [{ use: "INVESTMENT", amount: money(CAD, 100000n) }],
};

const actualInterest: Journal = {
  id: "int-actual",
  type: "INTEREST_CHARGED",
  tradeDate: "2024-01-10",
  sortKey: 0,
  status: "POSTED",
  source: "MANUAL",
  postings: [
    { accountId: "facility", amount: money(CAD, -90n) },
    { accountId: "expense", amount: money(CAD, 90n) },
  ],
};

describe("interest variance", () => {
  it("reports modelled minus actual without mutating books", () => {
    const journals = [draw, actualInterest];
    const model = modelInterest({
      journals,
      accounts,
      terms: {
        facilityAccountId: "facility",
        spreadBps: 0,
        dayCount: "ACT_365",
        postingDayRule: "CALENDAR_DAY",
        capitalizeInterest: true,
      },
      benchmarkCurve: [{ effectiveDate: "2024-01-01", rateBps: 365 }],
      periodStart: "2024-01-01",
      periodEnd: "2024-01-11",
    });

    expect(model.modelledTotalMinor).toBe(100n);

    const variance = interestVariance(model, journals, accounts);
    expect(variance.actualPostedMinor).toBe(90n);
    expect(variance.varianceMinor).toBe(10n);
    expect(variance.actualJournalIds).toContain("int-actual");
  });
});
