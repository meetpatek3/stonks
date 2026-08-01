# Plan 6: Canada Tax Module (flag-only)

**Goal:** Pure-domain Canada tax year summary with configurable inclusion rate and flag-only superficial loss / contribution hints.

**Status:** Implemented in `packages/ledger/src/tax/`.

## Scope

- `JurisdictionModule` interface for pluggable tax jurisdictions
- `CanadaJurisdiction` + `summarizeCanadaTaxYear`
- Realized gains/losses from reporting-currency gain lines (caller supplies)
- Taxable capital gains = `mulDivFloor(netGains, inclusionRateBps, 10000)` where net gains = max(0, gains − losses)
- Dividend, interest income, deductible investment-interest expense (passed in)
- **Flag only:** superficial loss candidates do not adjust numbers
- Disclaimer includes "not tax advice"

## Tests

`packages/ledger/tests/tax-canada.test.ts`

## Out of scope

- Contribution limit logic (flag stub only via `CONTRIBUTION_LIMIT` code in types)
- US or other jurisdictions
- UI tax views (Plan 8)
