import { describe, expect, it } from "vitest";
import {
  accountTone,
  isLiabilityType,
  mergeAccountsWithBalances,
  sortBalanceRows,
} from "@/lib/accounts-table";
import type { AccountRecord } from "@stonks/db";
import type { BalanceRow } from "@/lib/portfolio-shared";

describe("isLiabilityType", () => {
  it("marks only CREDIT_FACILITY as a liability", () => {
    expect(isLiabilityType("CREDIT_FACILITY")).toBe(true);
    expect(isLiabilityType("CASH")).toBe(false);
    expect(isLiabilityType("INVESTMENT")).toBe(false);
    expect(isLiabilityType("RECEIVABLE")).toBe(false);
    expect(isLiabilityType("EXTERNAL")).toBe(false);
  });
});

describe("accountTone", () => {
  it("returns danger for liabilities and default for assets", () => {
    expect(accountTone("CREDIT_FACILITY")).toBe("danger");
    expect(accountTone("CASH")).toBe("default");
    expect(accountTone("INVESTMENT")).toBe("default");
  });
});

describe("sortBalanceRows", () => {
  it("lists assets before liabilities, then by name", () => {
    const rows: BalanceRow[] = [
      bal("loan", "Investment loan", "CREDIT_FACILITY", "-3500000"),
      bal("inv", "Brokerage", "INVESTMENT", "1000000"),
      bal("cash", "Chequing", "CASH", "50000"),
      bal("recv", "Receivable", "RECEIVABLE", "100"),
    ];

    expect(sortBalanceRows(rows).map((r) => r.accountId)).toEqual([
      "inv",
      "cash",
      "recv",
      "loan",
    ]);
  });

  it("excludes EXTERNAL counterpart accounts from the overview", () => {
    const rows: BalanceRow[] = [
      bal("ext", "External", "EXTERNAL", "-100000"),
      bal("cash", "Chequing", "CASH", "100000"),
    ];
    expect(sortBalanceRows(rows).map((r) => r.accountId)).toEqual(["cash"]);
  });
});

describe("mergeAccountsWithBalances", () => {
  it("renders an account with no replay row at a zero replay balance", () => {
    const rows = mergeAccountsWithBalances(
      [account("new", "New savings", "CASH")],
      [],
    );

    expect(rows).toEqual([
      {
        accountId: "new",
        accountName: "New savings",
        accountType: "CASH",
        currency: "CAD",
        minor: "0",
        minorUnits: 2,
        taxTreatment: null,
        closedAt: null,
      },
    ]);
  });

  it("preserves asset-first ordering after merging persisted accounts", () => {
    const rows = mergeAccountsWithBalances(
      [
        account("loan", "Investment loan", "CREDIT_FACILITY"),
        account("cash", "Chequing", "CASH"),
        account("inv", "Brokerage", "INVESTMENT"),
      ],
      [bal("loan", "Ignored loan name", "CREDIT_FACILITY", "-3500000")],
    );

    expect(sortBalanceRows(rows).map((row) => row.accountId)).toEqual([
      "inv",
      "cash",
      "loan",
    ]);
  });
});

function bal(
  accountId: string,
  accountName: string,
  accountType: BalanceRow["accountType"],
  minor: string,
): BalanceRow {
  return {
    accountId,
    accountName,
    accountType,
    currency: "CAD",
    minor,
    minorUnits: 2,
  };
}

function account(
  id: string,
  name: string,
  type: AccountRecord["type"],
): AccountRecord {
  return {
    id,
    name,
    type,
    currency: "CAD",
    minorUnits: 2,
    taxTreatment: null,
    closedAt: null,
  };
}
