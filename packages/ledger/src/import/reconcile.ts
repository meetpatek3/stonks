import type { ReconciliationResult, Statement } from "./types.js";

export function reconcileStatement(
  statement: Statement,
  computedBalanceMinor: bigint,
): ReconciliationResult {
  const status =
    computedBalanceMinor === statement.statedBalanceMinor ? "MATCH" : "MISMATCH";

  return {
    statementId: statement.id,
    computedBalanceMinor,
    statedBalanceMinor: statement.statedBalanceMinor,
    status,
  };
}
