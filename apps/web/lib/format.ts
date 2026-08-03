/**
 * Presentation formatting module.
 *
 * This is the single sanctioned boundary where ledger domain values (bigint
 * minor units, fixed-scale decimal quantity strings) become display strings
 * and — only where a UI component demands it (e.g. `NumberValue`, chart
 * series) — display numbers. `Number(...)` on a money value must never
 * appear outside this file; every other module keeps money as `bigint` /
 * decimal string.
 *
 * Pure functions only, no React, importable from both server and client
 * components.
 */

/** Visible marker for absent/uncertain values. Never render `0`, a bare
 * "—", or a silently-substituted value in its place. */
export const UNKNOWN = "N/A";

/**
 * The one display locale. Named so that a server render and the client render
 * that hydrates it cannot disagree — `NumberValue` otherwise falls back to the
 * nearest `I18nProvider` or the runtime default, which differ between the two.
 */
export const DISPLAY_LOCALE = "en-CA";

/**
 * Format ledger minors as a currency string using only string/bigint
 * arithmetic (never `Number(...)` on the money value).
 */
export function formatMoney(minor: string, currency: string, minorUnits = 2): string {
  const scale = Number.isInteger(minorUnits) && minorUnits >= 0 ? minorUnits : 2;
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).replace(/^0+(?=\d)/, "") || "0";

  let whole: string;
  let fraction: string;
  if (scale === 0) {
    whole = digits;
    fraction = "";
  } else if (digits.length <= scale) {
    whole = "0";
    fraction = digits.padStart(scale, "0");
  } else {
    whole = digits.slice(0, -scale);
    fraction = digits.slice(-scale);
  }

  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const absolute = scale > 0 ? `${wholeGrouped}.${fraction}` : wholeGrouped;
  const signedNumber = `${negative ? "-" : ""}${absolute}`;

  try {
    const currencySample = new Intl.NumberFormat(DISPLAY_LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    }).format(0);
    const numberSample = new Intl.NumberFormat(DISPLAY_LOCALE, {
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    }).format(0);

    if (!currencySample.includes(numberSample)) {
      return `${signedNumber} ${currency}`;
    }

    const withAmount = currencySample.replace(numberSample, absolute);
    if (negative) {
      // Keep a leading minus even when Intl's sample was unsigned zero.
      return withAmount.includes("-") ? withAmount : `-${withAmount}`;
    }
    return withAmount;
  } catch {
    return `${signedNumber} ${currency}`;
  }
}

/**
 * Format a reporting-currency amount whose minor-unit scale may be unknown.
 *
 * Returns the `UNKNOWN` marker rather than falling back to two decimals: the
 * scale places the decimal point, so guessing it does not produce a
 * badly-formatted number, it produces a different number (150000 minor units
 * is ¥150,000 at scale 0 and ¥1,500.00 at scale 2).
 */
export function formatReportingMoney(
  minor: string,
  currency: string,
  minorUnits: number | null,
): string {
  return minorUnits == null ? UNKNOWN : formatMoney(minor, currency, minorUnits);
}

/**
 * Convert ledger minors to a display `number`, for feeding UI components
 * that require a `number` (e.g. `NumberValue`, chart series data points).
 *
 * This is the ONE sanctioned money→number conversion in the codebase. It is
 * display-only: `Number` loses precision for values beyond
 * `Number.MAX_SAFE_INTEGER`, so never use this result for further
 * arithmetic, comparisons, or persistence — only for rendering.
 */
export function minorToDisplayNumber(minor: string, minorUnits: number): number {
  const scale = Number.isInteger(minorUnits) && minorUnits >= 0 ? minorUnits : 2;
  return Number(minor) / 10 ** scale;
}

/**
 * Compact rendering of a chart-axis value.
 *
 * The input is a display `number` already produced by `minorToDisplayNumber`,
 * never a raw money value — this exists so that no component has to reach for
 * `Intl` itself to label an axis. Display-only, exactly like the conversion
 * that produced its input. No currency symbol: the axis is labelled with its
 * currency once, rather than on every tick.
 */
export function formatCompactNumber(value: number, locale = DISPLAY_LOCALE): string {
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Trim trailing zeros from a ledger fixed-scale decimal quantity string,
 * without ever converting through `Number`.
 */
export function formatQuantity(qty: string): string {
  const negative = qty.startsWith("-");
  const unsigned = negative ? qty.slice(1) : qty;
  const [wholePart, fractionPart] = unsigned.split(".");

  const trimmedFraction = fractionPart?.replace(/0+$/, "") ?? "";
  const trimmedWhole = (wholePart ?? "0").replace(/^0+(?=\d)/, "") || "0";

  const result = trimmedFraction.length > 0 ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;

  // Avoid a signed zero display (e.g. "-0" from "-0.00000000").
  if (result === "0") {
    return "0";
  }

  return negative ? `-${result}` : result;
}

/**
 * Format a basis-points count (a small integer, not a money value) as a
 * percentage string with two decimal places.
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Allowed values of HeroUI Pro's `TrendChip` `trend` prop, per
 * `@heroui-pro/react/dist/components/trend-chip/trend-chip.d.ts`.
 */
export type Trend = "down" | "neutral" | "up";

/** Classify a signed ledger minor value into a `TrendChip` trend. */
export function signedTrend(minor: string): Trend {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).replace(/^0+/, "");
  if (digits === "") {
    return "neutral";
  }
  return negative ? "down" : "up";
}

/**
 * Classify a basis-point figure into a `TrendChip` trend.
 *
 * Separate from `signedTrend` because basis points are a ratio, not money: they
 * arrive as a `number` from the read model, where a money value never may.
 */
export function bpsTrend(bps: number): Trend {
  if (bps > 0) return "up";
  if (bps < 0) return "down";
  return "neutral";
}

/**
 * Render a possibly-absent/uncertain value. Returns the `UNKNOWN` marker
 * for `null`/`undefined` rather than falling back to `0` or a bare dash.
 */
export function formatUncertain(value: string | null | undefined): string {
  return value == null ? UNKNOWN : value;
}
