/**
 * Pure helpers for the borrowing screen.
 *
 * Nothing here derives a figure from journals — that is the read model's job.
 * These helpers label facility uses and shape already-derived rows for charts,
 * converting money to display numbers only through `lib/format.ts`.
 */

import type { FacilityUse } from "@stonks/ledger";
import { minorToDisplayNumber } from "@/lib/format";
import type {
  FacilityInterestPoint,
  FacilityUseRow,
} from "@/lib/portfolio-shared";

const USE_LABELS: Record<FacilityUse, string> = {
  INVESTMENT: "Investment",
  LENDING: "Lending",
  PERSONAL: "Personal",
  OTHER: "Other",
};

/** Chart colour tokens, one per `FACILITY_USES` entry, cycling `--chart-1..5`. */
const USE_TOKENS: Record<FacilityUse, string> = {
  INVESTMENT: "var(--chart-1)",
  LENDING: "var(--chart-2)",
  PERSONAL: "var(--chart-3)",
  OTHER: "var(--chart-4)",
};

export function facilityUseLabel(use: FacilityUse): string {
  return USE_LABELS[use];
}

export type UseBreakdownSlice = {
  key: FacilityUse;
  label: string;
  owedMinor: string;
  bps: number | null;
  token: string;
};

/**
 * Pie-chart slices for a facility's use breakdown.
 *
 * Zero-owed uses are dropped — an empty arc is not information. The minor-unit
 * string is preserved so the tooltip can format from the ledger value rather
 * than from the plotted float.
 */
export function toUseBreakdownSlices(
  rows: readonly FacilityUseRow[],
): UseBreakdownSlice[] {
  return rows
    .filter((row) => row.owedMinor !== "0" && !row.owedMinor.startsWith("-0"))
    .filter((row) => {
      try {
        return BigInt(row.owedMinor) > 0n;
      } catch {
        return false;
      }
    })
    .map((row) => ({
      key: row.use,
      label: facilityUseLabel(row.use),
      owedMinor: row.owedMinor,
      bps: row.bps,
      token: USE_TOKENS[row.use],
    }));
}

/**
 * One chart datum. `modelled` is omitted (not zeroed) when the read model
 * could not estimate — plotting a zero would look like "no interest accrued".
 *
 * Only `string | number` fields are allowed: Pro chart roots type `data` as
 * `Record<string, number | string>[]`, so a boolean flag cannot ride along.
 */
export type InterestChartRow = {
  month: string;
  actual: number;
  actualMinor: string;
  modelled?: number;
  modelledMinor?: string;
};

export function toInterestChartRows(
  points: readonly FacilityInterestPoint[],
  minorUnits: number,
): InterestChartRow[] {
  return points.map((point) => {
    const row: InterestChartRow = {
      month: point.month,
      actual: minorToDisplayNumber(point.actualMinor, minorUnits),
      actualMinor: point.actualMinor,
    };
    if (point.modelledMinor !== null) {
      row.modelled = minorToDisplayNumber(point.modelledMinor, minorUnits);
      row.modelledMinor = point.modelledMinor;
    }
    return row;
  });
}
