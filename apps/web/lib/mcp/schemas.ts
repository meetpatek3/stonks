import { z } from "zod";

/**
 * Shared MCP wire schemas — the ONLY place money, quantity, and FX typing is
 * defined for tool inputs and outputs (design spec §4).
 *
 * JSON numbers are IEEE-754 doubles, and the domain forbids JS `number` on
 * money/quantity paths. Therefore:
 *
 * - Monetary amounts are strings of integer minor units, parsed with `BigInt`.
 * - Quantities are fixed-scale decimal strings (≤8 dp, matching
 *   `QUANTITY_SCALE`), parsed with `qtyFromDecimalString`.
 * - FX rates are rational `{ fxRateN, fxRateD }` bigint strings.
 * - Integer basis points are the only rate-like fields permitted as JSON
 *   numbers.
 *
 * A tool schema that types an amount, quantity, or FX rate as `z.number()` is
 * a correctness bug. No tool defines its own money schema — import from here.
 */

const MINOR_AMOUNT_TYPE_ERROR =
  "must be a string of integer minor units (JSON numbers are IEEE-754 doubles and lose precision — see stonks://reference/journal-types)";

/** Signed integer minor units as a string, e.g. `"-1500000"`. Parse with `BigInt`. */
export const zMinorAmount = z
  .string({ error: MINOR_AMOUNT_TYPE_ERROR })
  .regex(/^-?\d+$/, 'must be a signed integer string of minor units, e.g. "-1500000"');

/** Fixed-scale decimal string, ≤8 decimal places, e.g. `"420.00000000"`. Parse with `qtyFromDecimalString`. */
export const zQuantity = z
  .string({
    error:
      "must be a fixed-scale decimal string (JSON numbers are not accepted for quantities)",
  })
  .regex(
    /^-?\d+(\.\d{1,8})?$/,
    'must be a decimal string with at most 8 decimal places, e.g. "420.00000000"',
  );

/** Positive non-zero integer string — the denominator of a rational FX rate. */
const zPositiveBigIntString = z
  .string({ error: "must be a positive integer string (JSON numbers are not accepted)" })
  .regex(/^[1-9]\d*$/, 'must be a positive non-zero integer string, e.g. "100"');

/** Rational FX rate as bigint strings — never a float. */
export const zFxRational = z.object({
  fxRateN: z
    .string({ error: "must be an integer string (JSON numbers are not accepted)" })
    .regex(/^-?\d+$/, 'must be an integer string, e.g. "135"'),
  fxRateD: zPositiveBigIntString,
});

/** Trade date in ISO calendar form. */
export const zTradeDate = z
  .string({ error: "must be a YYYY-MM-DD date string" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date string (YYYY-MM-DD)");

/** ISO 4217-style currency code. */
export const zCurrencyCode = z
  .string({ error: "must be a currency code string" })
  .regex(/^[A-Z]{3}$/, 'must be a three-letter currency code, e.g. "CAD"');

/**
 * Basis points — the ONLY rate-like field permitted as a JSON number
 * (integers, not money; spec §8 tool 18).
 */
export const zBasisPoints = z
  .number({ error: "must be an integer number of basis points" })
  .int("must be an integer number of basis points");

/** Minor-unit string → bigint. The only money parse path for tool handlers. */
export function minorFromString(amountMinor: string): bigint {
  return BigInt(amountMinor);
}
