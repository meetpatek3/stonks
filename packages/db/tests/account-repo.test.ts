import { describe, expect, it } from "vitest";
import { toAccountRecord } from "../src/repos/account-repo.js";

/**
 * The account repo's row→record mapping, exercised without a database.
 * DB round-trips (household scoping, includeClosed) are covered in
 * `account-repo.integration.test.ts`.
 */
describe("toAccountRecord", () => {
  it("maps a joined account/currency row, converting closedAt to an ISO string", () => {
    const closed = new Date("2025-05-01T12:00:00.000Z");
    const record = toAccountRecord({
      id: "acct-1",
      householdId: crypto.randomUUID(),
      type: "INVESTMENT",
      currency: "CAD",
      taxTreatment: "TFSA",
      name: "Brokerage",
      contributionPolicyId: null,
      closedAt: closed,
      minorUnits: 2,
    });

    expect(record).toEqual({
      id: "acct-1",
      name: "Brokerage",
      type: "INVESTMENT",
      currency: "CAD",
      minorUnits: 2,
      taxTreatment: "TFSA",
      closedAt: "2025-05-01T12:00:00.000Z",
    });
  });

  it("keeps an open account's closedAt and absent tax treatment as null", () => {
    const record = toAccountRecord({
      id: "acct-2",
      householdId: crypto.randomUUID(),
      type: "CASH",
      currency: "USD",
      taxTreatment: null,
      name: "Chequing",
      contributionPolicyId: null,
      closedAt: null,
      minorUnits: 2,
    });

    expect(record.closedAt).toBeNull();
    expect(record.taxTreatment).toBeNull();
  });
});
