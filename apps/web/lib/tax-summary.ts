/**
 * Pure helpers for the tax screen.
 *
 * Nothing here summarizes a tax year — that is already derived in
 * `portfolio-derive`. These helpers only parse the year the user picked and
 * build the selectable range from the ledger's already-derived coverage.
 */

/**
 * Parse `?year=` from the tax route. Returns `undefined` when absent or not a
 * four-digit calendar year, so the read model can fall back to its own default
 * (the year of the most recent posted journal).
 */
export function parseTaxYearParam(
  raw: string | string[] | null | undefined,
): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : (raw ?? undefined);
  if (value == null || value === "") return undefined;
  if (!/^\d{4}$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Inclusive calendar-year range for the year selector.
 *
 * A quiet year inside the range belongs in the list: its zeroes are facts.
 * Years outside this range are not offered here; requesting one via the URL
 * still works, and the read model marks that summary uncertain.
 */
export function taxYearChoices(firstYear: number, lastYear: number): number[] {
  if (firstYear > lastYear) return [];
  const years: number[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    years.push(year);
  }
  return years;
}

/**
 * Years covered by the ledger, read off the value-over-time series.
 *
 * That series is oldest-first and fills every calendar month from the first
 * posted journal to the last, so its endpoints are the same bounds
 * `deriveTaxSummary` uses when deciding whether a requested year is outside
 * the ledger. Re-deriving the bounds from journals here would duplicate the
 * read model.
 */
export function taxYearsFromValueSeries(
  points: readonly { month: string }[],
): number[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  return taxYearChoices(
    Number(first.month.slice(0, 4)),
    Number(last.month.slice(0, 4)),
  );
}
