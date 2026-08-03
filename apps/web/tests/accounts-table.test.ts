import { describe, expect, it } from "vitest";
import {
  accountTone,
  isLiabilityType,
  sortBalanceRows,
} from "@/lib/accounts-table";
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
