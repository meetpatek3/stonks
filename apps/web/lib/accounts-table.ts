/**
 * Pure helpers for the accounts overview.
 *
 * Balances themselves come from the read model (replay). These helpers only
 * decide presentation order and which token marks a liability.
 */

import type { AccountRecord } from "@stonks/db";
import type { AccountType } from "@stonks/ledger";
import type { BalanceRow } from "@/lib/portfolio-shared";

export type AccountOverviewRow = BalanceRow & {
  taxTreatment: string | null;
  closedAt: string | null;
};

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
 * Project persisted household accounts onto replay balances for display.
 *
 * Account metadata always comes from the account repository. Replay remains
 * the only balance source; an absent replay row means no journal has ever
 * touched the account, so its replay balance is exactly zero.
 */
export function mergeAccountsWithBalances(
  accounts: readonly AccountRecord[],
  balances: readonly BalanceRow[],
): AccountOverviewRow[] {
  const balanceByAccountId = new Map(
    balances.map((balance) => [balance.accountId, balance]),
  );

  return accounts.map((account) => ({
    accountId: account.id,
    accountName: account.name,
    accountType: account.type,
    currency: account.currency,
    minor: balanceByAccountId.get(account.id)?.minor ?? "0",
    minorUnits: account.minorUnits,
    taxTreatment: account.taxTreatment,
    closedAt: account.closedAt,
  }));
}

/**
 * Accounts shown on the overview: household accounts only (no EXTERNAL
 * counterpart), assets before liabilities, then name.
 */
export function sortBalanceRows<T extends BalanceRow>(rows: readonly T[]): T[] {
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
