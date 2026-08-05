import { qtyFromDecimalString } from "@stonks/ledger";

/** Available cash in an account from replay balance minor string. */
export function cashAvailableMinor(balanceMinor: string | undefined): bigint {
  if (balanceMinor === undefined) return 0n;
  return BigInt(balanceMinor);
}

/**
 * Positive shortfall when `needMinor` exceeds available cash; else 0n.
 * Liability / facility accounts are not used as BUY funding in this form —
 * callers only pass brokerage/cash account balances.
 */
export function cashShortfallMinor(
  availableMinor: bigint,
  needMinor: bigint,
): bigint {
  if (needMinor <= availableMinor) return 0n;
  return needMinor - availableMinor;
}

/**
 * True when requested sell qty (positive decimal) exceeds position qty
 * (fixed-scale decimal string from PositionRow).
 */
export function exceedsPositionQty(
  positionQty: string | undefined,
  sellQtyPositive: string,
): boolean {
  const sellScaled = qtyFromDecimalString(sellQtyPositive).scaled;
  if (sellScaled <= 0n) return false;

  if (positionQty === undefined) return true;

  const positionScaled = qtyFromDecimalString(positionQty).scaled;
  return sellScaled > positionScaled;
}
