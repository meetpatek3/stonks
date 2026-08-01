# Dollar-day attribution + FX gain decomposition

**Built:** Plan 4 domain code in `@stonks/ledger`.

## Dollar-day interest attribution

- `packages/ledger/src/interest/dollar-days.ts` — `attributeInvestmentInterest` replays positions for each day in `[periodStart, periodEnd)`, accumulates closing `acbCostReportingMinor` per position as dollar-days, and allocates `investmentInterestMinor` via `allocateExact`. Zero total dollar-days → all interest in `unallocatedMinor`.

## FX gain decomposition

- `packages/ledger/src/fx/gain-decomposition.ts` — `decomposeFxGain` splits `gainReportingMinor` into asset movement (gain in trade currency at cost FX) and currency movement (exact remainder). Same-currency trades attribute all gain to asset.

## Tests

- `packages/ledger/tests/dollar-days.test.ts`
- `packages/ledger/tests/fx-gain-decomposition.test.ts` (includes property: asset + currency === total)
