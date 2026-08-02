import {
  isUnknownCost,
  qtyToDecimalString,
  replay,
  type Account,
  type AccountType,
  type Journal,
} from "@stonks/ledger";
import {
  emptyBalancesByType,
  emptyPortfolioSnapshot,
  type BalanceRow,
  type PortfolioSnapshot,
  type PositionRow,
} from "@/lib/portfolio-shared";

/**
 * Pure derivation of the portfolio read model.
 *
 * Everything returned here is derived by replaying posted journals — no
 * stored snapshots, no hardcoded figures. This module deliberately knows
 * nothing about the database so it can be exercised with in-memory journals;
 * `lib/portfolio.ts` supplies the persistence.
 *
 * Money stays `bigint` internally and leaves as minor-unit strings via
 * `bigint.toString()` (which never produces `"-0"`). `Number(...)` on a money
 * value must not appear in this file.
 */

/** Account metadata the read model needs beyond the ledger's `Account`. */
export type AccountMeta = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Currency minor-unit scale (0 for JPY, 2 for CAD/USD, …). */
  minorUnits: number;
};

export type DerivePortfolioInput = {
  householdId?: string;
  reportingCurrency: string;
  accounts: readonly AccountMeta[];
  journals: readonly Journal[];
};

export function derivePortfolioSnapshot(
  input: DerivePortfolioInput,
): PortfolioSnapshot {
  const { householdId, reportingCurrency, accounts, journals } = input;

  if (accounts.length === 0) {
    return emptyPortfolioSnapshot({
      householdId,
      reportingCurrency,
      message: "no accounts",
    });
  }

  const metaById = new Map(accounts.map((meta) => [meta.id, meta]));
  const ledgerAccounts = new Map<string, Account>(
    accounts.map((meta) => [
      meta.id,
      { id: meta.id, type: meta.type, currency: meta.currency },
    ]),
  );

  const state = replay(journals, ledgerAccounts, reportingCurrency);

  const balances: BalanceRow[] = [];
  for (const [accountId, balance] of state.balances) {
    const meta = metaById.get(accountId);
    if (!meta) {
      // replay's assertKnownAccounts makes this unreachable; fail loudly
      // rather than dropping money out of the totals.
      throw new Error(`Balance for account outside the household: ${accountId}`);
    }
    balances.push({
      accountId,
      accountName: meta.name,
      accountType: meta.type,
      currency: balance.currency,
      minor: balance.minor.toString(),
      minorUnits: meta.minorUnits,
    });
  }
  balances.sort((a, b) => a.accountName.localeCompare(b.accountName));

  const balancesByType = emptyBalancesByType();
  for (const row of balances) {
    balancesByType[row.accountType].push(row);
  }

  let netWorth = 0n;
  let invested = 0n;
  let borrowed = 0n;
  let totalsAreUncertain = false;

  for (const [accountId, balance] of state.balances) {
    const type = metaById.get(accountId)?.type;

    // EXTERNAL accounts model the outside world, so they never contribute to
    // any total. Skip them before the currency test: dropping one loses
    // nothing, and flagging uncertainty for it would claim the totals are
    // incomplete when they are not.
    if (type === "EXTERNAL") {
      continue;
    }

    if (balance.currency !== reportingCurrency) {
      // No FX rate available to state this in the reporting currency, so it
      // is excluded from the totals and the uncertainty is flagged instead.
      totalsAreUncertain = true;
      continue;
    }

    netWorth += balance.minor;
    if (type === "INVESTMENT") {
      invested += balance.minor;
    } else if (type === "CREDIT_FACILITY") {
      borrowed -= balance.minor;
    }
  }

  const positions: PositionRow[] = [];
  for (const [key, position] of state.positions) {
    const costUnknown = isUnknownCost(position.costState);
    positions.push({
      key,
      accountId: position.accountId,
      securityId: position.securityId,
      symbol: position.securityId,
      quantity: qtyToDecimalString(position.quantity),
      tradeCurrency: position.tradeCurrency,
      costReportingMinor: costUnknown
        ? null
        : position.acbCostReportingMinor.toString(),
      costIsUnknown: costUnknown,
    });
  }
  positions.sort((a, b) => a.key.localeCompare(b.key));

  const unknownCost = positions.filter((p) => p.costIsUnknown).length;

  return {
    householdId,
    reportingCurrency,
    ledgerVersion: state.ledgerVersion,
    balances,
    balancesByType,
    positions,
    netWorthMinor: netWorth.toString(),
    totalInvestedMinor: invested.toString(),
    totalBorrowedMinor: borrowed.toString(),
    totalsAreUncertain,
    openItemCounts: { unknownCost, total: unknownCost },
  };
}
