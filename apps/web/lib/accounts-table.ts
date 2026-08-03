/**
 * Pure helpers for the accounts overview.
 *
 * Balances themselves come from the read model (replay). These helpers only
 * decide presentation order and which token marks a liability.
 */

import type { AccountType } from "@stonks/ledger";
import type { BalanceRow } from "@/lib/portfolio-shared";

/** Credit facilities are the only liability account type in this ledger. */
export function isLiabilityType(type: AccountType): boolean {
  return type === "CREDIT_FACILITY";
}

/**
 * HeroUI status token for an account chip / balance. Liabilities use `danger`
 * so they read differently from assets without inventing a custom colour.
 */
export function accountTone(
  type: AccountType,
): "danger" | "default" {
  return isLiabilityType(type) ? "danger" : "default";
}

/**
 * Accounts shown on the overview: household accounts only (no EXTERNAL
 * counterpart), assets before liabilities, then name.
 */
export function sortBalanceRows(rows: readonly BalanceRow[]): BalanceRow[] {
  return rows
    .filter((row) => row.accountType !== "EXTERNAL")
    .slice()
    .sort((a, b) => {
      const aLiab = isLiabilityType(a.accountType) ? 1 : 0;
      const bLiab = isLiabilityType(b.accountType) ? 1 : 0;
      if (aLiab !== bLiab) return aLiab - bLiab;
      return a.accountName.localeCompare(b.accountName);
    });
}
