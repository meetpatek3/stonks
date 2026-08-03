/**
 * Pure helpers for the positions grid.
 *
 * Nothing here derives a figure: these are comparators for sorting rows the
 * read model already produced, and a classifier that decides which *labels* a
 * row carries. Money never becomes a `number` — the comparators work in
 * `bigint`, so a value beyond `Number.MAX_SAFE_INTEGER` still sorts correctly.
 *
 * No React, so this is unit-testable on its own.
 */

import type { PositionRow } from "@/lib/portfolio-shared";

/**
 * Order two minor-unit money strings, treating an absent figure as smaller
 * than every present one.
 *
 * `DataGrid` sorts by calling the comparator and negating the result for a
 * descending sort, so a comparator cannot make absent values sort last in both
 * directions. They sort last ascending and first descending; either way they
 * cluster, which is what a reader scanning for "which rows are missing a
 * figure" wants.
 */
export function compareMinor(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  }
  return compareBigInt(BigInt(a), BigInt(b));
}

/** The same ordering for a nullable integer (basis points, counts). */
export function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order two ledger fixed-scale decimal quantity strings.
 *
 * Parsed to a scaled `bigint` rather than compared as text ("9" > "10"
 * lexically) or through `Number` (which would lose the ledger's 8 decimal
 * places on a large holding).
 */
export function compareQuantity(a: string, b: string): number {
  return compareBigInt(scaledQuantity(a), scaledQuantity(b));
}

const QUANTITY_SCALE = 8;

function scaledQuantity(qty: string): bigint {
  const negative = qty.startsWith("-");
  const unsigned = negative ? qty.slice(1) : qty;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled = BigInt(
    `${whole || "0"}${fraction.padEnd(QUANTITY_SCALE, "0").slice(0, QUANTITY_SCALE)}`,
  );
  return negative ? -scaled : scaled;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Which qualifiers a row carries, kept as two independent facts because they
 * are two different claims.
 *
 * A stale mark is a *real* price for an earlier date — the row is as of that
 * date, not incomplete — while an absent figure means the read model refused
 * to derive one. Labelling the first "incomplete" would be the same
 * mislabelling the read model's own `staleReasons` split exists to prevent.
 * Both can be true at once.
 */
export type PositionQualifiers = {
  /** The mark is real but belongs to an earlier date than the valuation date. */
  isStale: boolean;
  /** At least one figure the grid shows could not be derived. */
  isIncomplete: boolean;
};

/**
 * Reasons the read model raised against **every** holding.
 *
 * Some gaps are portfolio-level facts that the read model states once per row —
 * a fee naming no holding is excluded from every holding's net return, so every
 * row carries the same sentence. Repeating it under each symbol reads as four
 * separate problems. Shown once, it reads as the one fact it is.
 *
 * A single holding has no "every row" to distinguish, so nothing is lifted:
 * its reasons stay under its own symbol where they belong.
 */
export function sharedUncertaintyReasons(rows: readonly PositionRow[]): string[] {
  const [first, ...rest] = rows;
  if (!first || rest.length === 0) return [];

  return first.valuationUncertaintyReasons.filter((reason) =>
    rest.every((row) => row.valuationUncertaintyReasons.includes(reason)),
  );
}

export function positionQualifiers(row: PositionRow): PositionQualifiers {
  const missing =
    row.costIsUnknown ||
    row.costReportingMinor === null ||
    row.marketValueMinor === null ||
    row.unrealizedGainMinor === null ||
    row.interestCostMinor === null ||
    row.feeCostMinor === null ||
    row.grossReturnBps === null ||
    row.netReturnBps === null;

  return { isStale: row.priceIsStale, isIncomplete: missing };
}
