/**
 * Decimal price string → `bigint` minor units.
 *
 * Market data providers report prices as decimal strings ("213.4567"). Parsing
 * one through `Number` / `parseFloat` silently corrupts every valuation
 * downstream — a double cannot hold `9007199254740993.01`, and `0.1 + 0.2`
 * arithmetic is not what a ledger means by a price. So this conversion is done
 * entirely with string slicing and `BigInt`; `Number` appears here only for
 * validating the *scale* argument (a small integer, never a money value).
 */

/** A plain decimal literal: optional sign, digits, optional fraction. No exponent, no grouping. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * Convert a decimal price string to minor units at `minorUnits` scale.
 *
 * Rounding rule: **half away from zero** — `1.005` at scale 2 is `101`, and
 * `-1.005` is `-101`. Chosen because it is the rule a human reading a price
 * expects, and because it is symmetric about zero, so a long and a short
 * position in the same security round to mirrored amounts rather than drifting
 * apart. Rounding is decided by the full dropped remainder (its first digit),
 * never by rounding digit-by-digit.
 *
 * Returns `null` — never throws, never guesses — when the input is not a plain
 * decimal string or the scale is not a non-negative integer. A provider that
 * returns garbage must degrade to "no quote", not to a wrong price.
 */
export function decimalStringToMinor(value: string, minorUnits: number): bigint | null {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) return null;

  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [wholePart = "", fractionPart = ""] = unsigned.split(".");

  const whole = wholePart === "" ? "0" : wholePart;
  const kept = fractionPart.slice(0, minorUnits).padEnd(minorUnits, "0");
  const dropped = fractionPart.slice(minorUnits);

  // The dropped tail is worth ≥ ½ of a minor unit exactly when its first digit is ≥ 5.
  const roundAway = dropped.length > 0 && dropped.charCodeAt(0) >= "5".charCodeAt(0);

  const magnitude = BigInt(whole + kept) + (roundAway ? 1n : 0n);
  return negative ? -magnitude : magnitude;
}
