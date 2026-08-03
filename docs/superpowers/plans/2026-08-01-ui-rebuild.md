# Plan — Portfolio Tracker UI Rebuild (HeroUI Pro default dark)

Repairs the broken web UI and rebuilds it on the HeroUI **default dark** theme with
HeroUI **Pro** financial components, replacing hardcoded demo data with real ledger
replay output.

Repo: `/Users/meetpatel/Developer/stonks/.claude/worktrees/portfolio-tracker-ui-rebuild-436269`
Branch: `claude/portfolio-tracker-ui-rebuild-436269`

---

## Diagnosis (verified, not assumed)

The app **builds successfully**. Nothing is a compile error. It is broken visually and
in data integrity:

1. **Pro component CSS is never imported.** `apps/web/app/globals.css` imports
   `@heroui/styles` and `@heroui-pro/react/themes/glass`, but **never**
   `@heroui-pro/react/css`. The glass file is a theme *override* only — it contains no
   structural component CSS. Every Pro component in use (`Sidebar`, `KPI`, `KPIGroup`,
   `EmptyState`) therefore renders **completely unstyled**.
2. **Six pages style themselves with CSS variables that are defined nowhere.**
   `charts`, `entry`, `ledger`, `open-items`, `positions`, `tax` reference
   `--color-fog`, `--color-mint`, `--color-mint-dim`, `--color-ink`, `--color-line`,
   `--color-warn`, `--color-danger` and the classes `font-display` / `animate-rise`.
   A repo-wide grep confirms **zero definitions** for any of them. Result: invisible or
   unstyled text, no borders, no animation.
3. **Dead navigation.** `components/app-shell.tsx` exposes exactly two sidebar links.
   The second points at `/api/ledger/balances` — a raw JSON API route. Six real pages
   are unreachable from the UI.
4. **Demo data renders in the real app.** `lib/demo-portfolio.ts` hardcodes balances,
   positions, journals, tax figures and chart series. `positions`, `ledger`, `tax`,
   `open-items` and `charts` render it unconditionally — a household with real journals
   still sees fabricated numbers. This violates the project's own first guiding
   principle ("the transaction ledger is the authoritative source of truth").
5. **`/api/portfolio` always returns demo data**, regardless of DB state.
6. **Fast entry writes nothing.** `app/(app)/entry/page.tsx` fakes a save with
   `setTimeout`. There is no journal-creation endpoint.
7. **No borrowing/interest screen exists at all** — the product's central
   differentiator (`packages/ledger/src/interest/*` is fully implemented and unused
   by the UI).
8. `globals.css` imports `tailwindcss` twice (once directly, once via `@heroui/styles`).

The existing design spec `docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md`
§8 **already mandates** "HeroUI default dark theme" and "HeroUI Pro chart components
(not custom Recharts wrappers)". The current code deviates from the project's own spec;
this plan brings it back in line.

---

## Global Constraints

These bind **every** task. Reviewers check against them verbatim.

**Theme**
- The **HeroUI default dark theme**, activated by `data-theme="dark"` on `<html>`.
- `apps/web/app/globals.css` contains **import statements only** — exactly:
  ```css
  @import "tailwindcss";
  @import "@heroui/styles";
  @import "@heroui-pro/react/css";
  ```
  No custom CSS custom properties, no `@theme` block, no `.glass-*` selectors, no
  bespoke `body`/`html` rules, no font declarations.
- No custom colour values anywhere in components. Use HeroUI design tokens only:
  `bg-background`, `bg-surface`, `bg-surface-secondary`, `text-foreground`,
  `text-muted`, `text-accent`, `text-success`, `text-warning`, `text-danger`,
  `border-border`, `border-separator`. Chart series use the `--chart-1..5` tokens.
- No arbitrary-value Tailwind colour classes (`text-[var(--color-fog)]`,
  `bg-[#123456]`). If a colour is needed and no token fits, raise it — do not invent one.

**Data integrity**
- Ledger replay is the only source of displayed numbers. After Task 3,
  `lib/demo-portfolio.ts` must not exist and nothing may import it.
- Money and quantities stay `bigint` / decimal-string through all domain and DB code.
  `Number(...)` on a money value is permitted **only** inside the presentation
  helpers in `apps/web/lib/format.ts`, at the render boundary, never in
  `packages/ledger`, `packages/db`, or any read-model computation.
- Missing / uncertain values (unknown cost basis, missing FX rate, estimated interest,
  stale price) render as a visible uncertainty marker — never as `0`, `—` alone, or a
  silently-substituted value.
- When `DATABASE_URL` is absent or the household has no data, pages render a Pro
  `EmptyState` explaining the real reason. They must not fall back to sample numbers.

**Components**
- All financial UI uses HeroUI Pro components, not hand-rolled markup:
  `KPI`, `KPIGroup`, `TrendChip`, `NumberValue`, `AreaChart`, `LineChart`, `PieChart`,
  `DataGrid`, `Widget`, `EmptyState`, `Sidebar`, `Segment`, `ChartTooltip`.
  Tables must use `DataGrid` — no raw `<table>` markup.
- Base components come from `@heroui/react`; Pro components from
  `@heroui-pro/react/<component>` subpath imports (matching the existing style in
  `components/app-shell.tsx`).
- Read the shipped types before using a Pro component:
  `apps/web/node_modules/@heroui-pro/react/dist/components/<name>/index.d.ts`.
  Never guess a Pro component's props or anatomy.
- `onPress`, not `onClick`. Compound dot-notation anatomy (`Card.Header`, `KPI.Value`).
  `Separator`, never `Divider`.

**Responsiveness**
- Every screen works at 375px and 1440px. Wide content (grids, charts) scrolls inside
  its own container; the page body never scrolls horizontally.

**Testing (TDD — non-negotiable)**
- Write the failing test first. Run it. Confirm it fails **for the intended reason**.
  Then implement. Then confirm it passes.
- Web tests: `apps/web/tests/*.test.ts(x)`, run with `pnpm --filter @stonks/web test`.
  If the web package has no test setup yet, Task 2 establishes it (vitest, matching
  `packages/ledger`'s config style).
- Pure logic (formatting, read-model derivation) gets real unit tests with
  independently-calculated expected values — never snapshots of current output.
- After any change: `pnpm --filter @stonks/web build` and
  `pnpm --filter @stonks/web typecheck` must both pass.

---

## Task 1: Reset the theme to HeroUI default dark

**Goal:** delete all bespoke CSS and run on the stock HeroUI default dark theme with
Pro component styles correctly loaded.

**Files:** `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `AGENTS.md`

**Steps**

1. Write `apps/web/tests/theme.test.ts` first, asserting against the *text* of
   `apps/web/app/globals.css` and `apps/web/app/layout.tsx`:
   - `globals.css` imports `tailwindcss`, `@heroui/styles`, and
     `@heroui-pro/react/css`, in that order.
   - `globals.css` imports `tailwindcss` exactly once.
   - `globals.css` contains **no** custom property declarations (no `--` at the start
     of any declaration), no `glass`, no `@theme`.
   - `layout.tsx` sets `data-theme="dark"` on `<html>` and does not reference `glass`.
   Run it — it must fail on the current files.
2. Replace `globals.css` with exactly the three imports from Global Constraints.
   Nothing else.
3. `layout.tsx`: set `<html lang="en" className="dark" data-theme="dark">`. Remove the
   `next/font/google` Inter import and the `--font-inter` variable — the default theme
   supplies its own typography. Keep `<body className="min-h-svh antialiased">`.
4. Update the `AGENTS.md` "Stack" bullet: the UI line currently instructs future agents
   to *keep the glass overrides and Inter*. Replace it with the default-dark rule and a
   pointer to this plan's Global Constraints.
5. Verify: test passes, `build` passes, `typecheck` passes.

**Out of scope:** page-level markup. Pages will still look wrong after this task
because they reference undefined variables — Tasks 5-11 fix them.

---

## Task 2: Presentation formatting module

**Goal:** one audited boundary where ledger minors become display strings/numbers, so
no other file needs `Number(...)` on money.

**Files:** `apps/web/lib/format.ts` (new), `apps/web/tests/format.test.ts` (new),
`apps/web/vitest.config.ts` (new if absent), `apps/web/package.json`

**Steps**

1. If `apps/web` has no test runner, add `vitest` + a `test` script + config mirroring
   `packages/ledger`'s setup. Verify a trivial test runs.
2. Write `apps/web/tests/format.test.ts` first, covering the functions below with
   hand-calculated expectations. Run it; confirm it fails because `lib/format.ts`
   does not exist.
3. Implement `apps/web/lib/format.ts`:
   - Move `formatMoney` here from `lib/portfolio-shared.ts` unchanged in behaviour
     (it is already correct: string/bigint arithmetic only). Re-export from the old
     path or update importers — do not duplicate the implementation.
   - `minorToDisplayNumber(minor: string, minorUnits: number): number` — the **only**
     sanctioned money→number conversion, for feeding `NumberValue` and chart series.
     Document in a comment that it is display-only and lossy for very large values.
   - `formatQuantity(qty: string): string` — trims trailing zeros from the ledger's
     fixed-scale decimal strings without using `Number`. Must handle `"420.00000000"`
     → `"420"`, `"0.50000000"` → `"0.5"`, `"1000.00000001"` → `"1000.00000001"`.
   - `formatBps(bps: number): string` — `842` → `"8.42%"`, `-125` → `"-1.25%"`, `0` →
     `"0.00%"`.
   - `signedTrend(minor: string): "up" | "down" | "neutral"` — for `TrendChip`'s
     `trend` prop. Match the actual prop values in the shipped `trend-chip` types.
   - `UNKNOWN` display constant plus `formatUncertain(...)` returning a marker for
     absent/uncertain values, per the Global Constraint on uncertainty.
4. Required test cases (assert exact strings): negative money, zero-minor-unit currency
   (JPY, `minorUnits: 0`), a value smaller than one major unit (`"5"` at
   `minorUnits: 2` → `"$0.05"`), thousands grouping, and each `formatQuantity` /
   `formatBps` case listed above.
5. Verify: tests pass, `build` + `typecheck` pass.

---

## Task 3: Real read model — accounts, positions, borrowing

**Goal:** replace demo data with values derived from ledger replay.

**Files:** `apps/web/lib/portfolio.ts`, `apps/web/lib/portfolio-shared.ts`,
`apps/web/lib/demo-portfolio.ts` (delete), `apps/web/app/api/portfolio/route.ts`
(delete), `apps/web/tests/portfolio.test.ts` (new)

**Steps**

1. Read the ledger's public API at `packages/ledger/src/index.ts` and the position
   state types in `packages/ledger/src/ledger/positions.ts` before designing.
2. Write `apps/web/tests/portfolio.test.ts` first. Build in-memory `Journal[]` +
   `Account` maps directly (do not require a database), call the read-model function,
   and assert derived figures computed by hand. Cover at minimum: an investment
   account with two buys (ACB), a cash account, a credit-facility account carrying a
   negative balance, and an account with an unknown opening cost basis that must
   surface as uncertain. Run it; confirm it fails.
3. Extend the snapshot type in `portfolio-shared.ts` and the builder in `portfolio.ts`
   so the snapshot carries, all derived via `replay(...)` / `applyPositionsForJournal`:
   - balances grouped by account type (investment / cash / liability / external)
   - `netWorthMinor`, `totalInvestedMinor`, `totalBorrowedMinor` in reporting currency
   - positions: security id, symbol, quantity, cost in reporting currency, and an
     explicit `costIsUnknown` flag driven by `isUnknownCost`
   - counts for the open-items badge
   Keep every money field a **string of minors**. No `number` money on this type.
4. Delete `lib/demo-portfolio.ts` and `app/api/portfolio/route.ts`. Fix every importer
   — after this task `grep -r demo-portfolio apps/web` returns nothing.
   Pages that lose their data source in this task may render a temporary
   `EmptyState`; Tasks 6-11 give them real UI.
5. Verify: tests pass, `build` + `typecheck` pass, grep is clean.

---

## Task 4: Read model — series, open items, tax

**Goal:** the remaining derived data the screens need.

**Files:** `apps/web/lib/portfolio.ts`, `apps/web/lib/portfolio-shared.ts`,
`apps/web/tests/portfolio-series.test.ts` (new)

**Steps**

1. Write the failing test first, with hand-calculated expectations over a small
   in-memory journal set.
2. Add to the read model:
   - `allocation`: per-position share of invested value, as integer basis points
     summing to exactly 10000 (allocate the rounding remainder with the ledger's
     `allocateExact` — do not let percentages drift). Assert the sum in a test.
   - `valueOverTime`: month-end reporting-currency portfolio value from replay,
     as `{ month: "YYYY-MM", valueMinor: string }[]`.
   - `openItems`: real data-quality findings derived from state — unknown cost basis,
     missing FX rate, interest variance (`interestVariance`), unreconciled statements
     — each with `kind`, `severity`, `message`, and the id of the journal/position it
     traces to (per the "every value is traceable" principle).
   - `taxSummary`: call `summarizeCanadaTaxYear` for the requested year; carry through
     its `TaxFlag[]` unchanged. Never fabricate a figure when inputs are missing —
     mark it uncertain.
3. Verify: tests pass, `build` + `typecheck` pass.

---

## Task 5: App shell and navigation

**Goal:** every screen reachable; shell built from Pro navigation components.

**Files:** `apps/web/components/app-shell.tsx`, `apps/web/app/(app)/layout.tsx`

**Steps**

1. Read the shipped types for `sidebar` and `app-layout` in
   `apps/web/node_modules/@heroui-pro/react/dist/components/` before writing.
2. Rebuild the sidebar navigation with these entries, in order, each pointing at a
   real page route:
   Overview `/` · Accounts `/accounts` · Positions `/positions` ·
   Transactions `/ledger` · Borrowing `/borrowing` · Charts `/charts` ·
   Tax `/tax` · Open Items `/open-items` · New Entry `/entry`
3. **Remove the `/api/ledger/balances` link entirely** — a nav item must never point at
   a JSON endpoint.
4. Show the open-items count as a badge on the Open Items entry, from the read model.
5. Active-route highlighting must handle nested paths (`/positions/xyz` highlights
   Positions). The current `pathname === "/"` check is not sufficient.
6. Mobile: the sidebar collapses to an overlay/drawer at small widths and the app is
   fully navigable at 375px.
7. Keep the existing sign-out behaviour and username display.
8. Verify: `build` + `typecheck` pass. Note in the report which routes do not yet
   exist (later tasks create them).

---

## Task 6: Portfolio overview

**Goal:** the landing screen, on real data, using Pro financial components.

**Files:** `apps/web/components/dashboard.tsx`, `apps/web/app/(app)/page.tsx`

**Steps**

1. Read the shipped types for `kpi`, `kpi-group`, `trend-chip`, `number-value`,
   `area-chart`, `pie-chart` before writing.
2. `KPIGroup` of headline metrics from the read model: net worth, total invested,
   total borrowed, period return **net of all costs**. Each uses `NumberValue` for the
   figure and `TrendChip` for direction. Per spec §8, returns default to net-of-costs
   and must be **explicitly labelled** as such.
3. `AreaChart` of `valueOverTime` and `PieChart` of `allocation`, both using
   `--chart-*` tokens and a Pro `ChartTooltip`. No custom Recharts wrappers.
4. Account balance cards grouped by type, liabilities visibly distinguished from
   assets (token colours only).
5. `EmptyState` for the no-data / no-DATABASE_URL cases, stating the real reason.
6. Any figure the read model marks uncertain renders with its uncertainty marker.
7. Verify: `build` + `typecheck` pass; check both 375px and 1440px.

---

## Task 7: Positions

**Goal:** per-position economics including financing cost — the product's core question.

**Files:** `apps/web/app/(app)/positions/page.tsx`, plus a client component as needed

**Steps**

1. Read the shipped `data-grid` types before writing.
2. Replace the current demo-data page with a `DataGrid` over real positions:
   symbol, quantity (`formatQuantity`), cost basis, market value, unrealized gain,
   **gross return**, attributed **interest cost** (`attributeInvestmentInterest`), and
   **net-of-borrow-cost return**. Gross and net must be separate, labelled columns.
3. Positions with unknown cost basis show the uncertainty marker in every derived
   column — never a computed number from a missing basis.
4. Sortable columns; horizontal scroll inside the grid container on mobile.
5. `EmptyState` when there are no positions.
6. Verify: `build` + `typecheck` pass.

---

## Task 8: Borrowing and interest

**Goal:** the screen the product is named for, currently absent entirely.

**Files:** `apps/web/app/(app)/borrowing/page.tsx` (new), read-model additions

**Steps**

1. Read `packages/ledger/src/interest/` — `use-slices.ts`, `accrue.ts`, `variance.ts`,
   `dollar-days.ts` — and their tests, to use the real APIs correctly.
2. Build the screen from real replay output:
   - `KPIGroup`: outstanding facility balance, effective rate, interest charged
     year-to-date, share of borrowing attributed to investments.
   - Facility use breakdown (`FACILITY_USES`) showing how borrowed funds were used —
     investment vs other — via `replayFacilitySlices` / `sumSlices`.
   - Interest over time as a Pro `LineChart` or `AreaChart`.
   - Modelled vs actual interest variance from `interestVariance`, with estimated
     figures explicitly flagged as estimates per the uncertainty constraint.
3. `EmptyState` when the household has no credit facilities.
4. Verify: `build` + `typecheck` pass.

---

## Task 9: Transactions and accounts

**Goal:** the ledger view and an accounts overview, on real journals.

**Files:** `apps/web/app/(app)/ledger/page.tsx`,
`apps/web/app/(app)/accounts/page.tsx` (new)

**Steps**

1. Transactions: `DataGrid` over real posted journals — trade date, type, accounts
   touched, memo, signed amount. Filter by journal type and by account
   (`Segment` or `Select`). Superseded journals are visibly marked, not hidden — the
   audit history must remain visible.
2. Accounts: one card or grid row per account with type, currency, and replay balance;
   liabilities distinguished from assets.
3. Both use `EmptyState` when empty. Replace the raw `<table>` in the current ledger
   page — `DataGrid` only.
4. Verify: `build` + `typecheck` pass.

---

## Task 10: Tax and open items

**Goal:** both remaining demo-data pages on real read-model output.

**Files:** `apps/web/app/(app)/tax/page.tsx`, `apps/web/app/(app)/open-items/page.tsx`

**Steps**

1. Tax: render `taxSummary` for a user-selectable year. Show realized gains, taxable
   capital gains, dividend income, deductible investment interest, and every
   `TaxFlag`. Keep the "not tax advice" disclaimer prominent, using the `warning`
   token. Flags are informational — never silently applied to the figures.
2. Open items: render real `openItems` grouped by severity, each linking to the
   journal or position it traces to. Show the total count consistent with the sidebar
   badge from Task 5.
3. Both use `EmptyState` when empty (for open items, an empty state is a *good*
   outcome — word it accordingly).
4. Verify: `build` + `typecheck` pass.

---

## Task 11: Fast transaction entry

**Goal:** entry actually posts a balanced journal. Spec §8 targets under ~15s on phone.

**Files:** `apps/web/app/(app)/entry/page.tsx`,
`apps/web/app/api/journals/route.ts` (new), `apps/web/tests/journals-api.test.ts` (new)

**Steps**

1. Write the failing API test first: a balanced journal is accepted; an **unbalanced**
   journal is rejected with a 400 and a clear message; a request for another
   household's account is rejected. Run it; confirm it fails.
2. Implement `POST /api/journals`: authenticate via the existing session helper,
   validate with `assertJournalBalanced` (and `assertFacilityUseComplete` where facility
   uses are present), persist via `createJournalRepo(db).insertPosted`. Return the
   `ValidationError` message on rejection. Money arrives as **minor-unit strings** and is
   parsed to `bigint` — never through `Number`.
3. Rewrite the entry form against this endpoint: real submit, real pending state, real
   error surface, success confirmation. Remove the `setTimeout` fake save.
4. Defaults per spec §8: today's date prefilled, currency defaulting to the household
   reporting currency, most-recently-used account preselected.
5. Journals are immutable — the form creates only. No edit/delete path.
6. Verify: tests pass, `build` + `typecheck` pass.

---

## Task 12: Price and security schema

**Added 2026-08-03.** Owner decision: the app cannot answer its central question — what did an
investment earn after all costs — because no price source exists, so positions are carried at
cost and unrealized gain is unknowable. Tasks 12-14 fix that. **Execute 12 → 13 → 14 before
Task 7**, which depends on them.

`packages/ledger/src/market/types.ts` already defines `PriceQuote`, `PriceOverride`,
`MarketDataProvider`, and `resolvePrice` (which never invents a price). The domain layer is
done; the persistence and wiring are missing.

**Files:** `packages/db/src/schema/security.ts` (new),
`packages/db/src/schema/price.ts` (new), `packages/db/src/schema/index.ts`,
`packages/db/drizzle/` (new migration), `packages/db/src/repos/price-repo.ts` (new),
`packages/db/tests/price-repo.integration.test.ts` (new)

**Steps**

1. Read `packages/db/src/schema/account.ts` and `packages/db/src/repos/journal-repo.ts` first —
   match their conventions exactly (household scoping, money columns, id style).
2. Write the failing repo test first, following `packages/db/tests/journal-repo.integration.test.ts`.
3. Schema. Securities are identified **independently of ticker symbols** so a symbol change,
   exchange change, or cross-listing cannot create a duplicate position or a phantom gain — this
   is a stated product requirement, not an optimisation:
   - `security`: stable id, name, security type, and the currency it trades in.
   - `security_symbol`: symbol + exchange + effective date range, many-to-one onto `security`.
   - `price_quote`: security, currency, `as_of` date, `price_minor` (money column — follow the
     existing money column convention, never a float), `source`, `fetched_at`.
   - `price_override`: security, `as_of`, `price_minor`, `note`, plus who/when. Append-only —
     an override is never updated in place, so the history of manual prices stays auditable.
   All tables are household-scoped where the data is household-specific. Quotes are shared
   reference data; overrides are household-specific. State which you chose and why.
4. `price-repo.ts`: fetch overrides for a household, upsert quotes, and read the most recent
   quote at or before a date. Money in and out as `bigint`; never `number`.
5. Generate the drizzle migration. Do not hand-edit generated SQL beyond what drizzle emits.
6. Verify: repo tests pass, `pnpm -r typecheck` passes, migration applies cleanly.

**Out of scope:** the provider (Task 13) and any UI.

---

## Task 13: Market data provider

**Goal:** real quotes behind the existing `MarketDataProvider` interface, plus manual overrides.

**Provider (owner decision 2026-08-03): Twelve Data.** Free tier ~800 requests/day, covers
stocks, ETFs and FX across US and international exchanges including TSX. Requires
`TWELVEDATA_API_KEY`. The fixture provider stays the default when no key is configured.

**Files:** `apps/web/lib/market/provider.ts` (new),
`apps/web/lib/market/twelve-data.ts` (new), `apps/web/lib/market/price-service.ts` (new),
`apps/web/tests/price-service.test.ts` (new), `.env.example`

**Steps**

1. Write the failing tests first, against a **fake** provider — no network calls in tests, ever.
2. Implement one concrete `MarketDataProvider` against the external service named in the
   dispatch. It must:
   - be selected by environment variable, with the fixture provider as the default when no API
     key is configured, so the app still runs self-hosted with no external dependency;
   - never throw into a render path — a provider failure resolves to "no quote", which
     `resolvePrice` already handles by returning `null`;
   - convert the provider's decimal price string to `bigint` minor units **without** going
     through `Number`. A float parse here silently corrupts every valuation downstream.
3. `price-service.ts`: given securities and a date, resolve each price via `resolvePrice`
   (overrides win over quotes), persist fetched quotes through the price repo, and return each
   result tagged with `source` (`OVERRIDE` | `QUOTE` | `NONE`), `asOf`, and a `stale` flag when
   `asOf` is older than the requested date. Never substitute a nearby price silently — when the
   only available quote is older, return it **with** its real `asOf` and `stale: true`, per the
   product rule that the most recent available price is shown with its timestamp.
4. Document the required environment variables in `.env.example` and `AGENTS.md`.
5. Verify: tests pass (no network), `build` and `typecheck` pass.

---

## Task 14: Valuation in the read model

**Goal:** market value, unrealized gain, and returns — gross and net of borrowing cost.

**Files:** `apps/web/lib/portfolio-derive.ts`, `apps/web/lib/portfolio-shared.ts`,
`apps/web/tests/portfolio-valuation.test.ts` (new)

**Steps**

1. Write the failing test first, in the established style: in-memory journals and accounts, an
   injected fake price source, hand-calculated expectations. No database, no network.
2. Add to the read model, per position and in aggregate:
   - `marketValueMinor` — quantity × resolved price, in the position's trade currency and
     converted to reporting currency where a rate exists.
   - `unrealizedGainMinor` — market value less cost basis.
   - `grossReturnBps` — return before financing and costs.
   - `interestCostMinor` — attributed borrowing cost via `attributeInvestmentInterest`.
   - `netReturnBps` — return **after** attributed interest and fees. This is the product's
     headline number and defaults to net; gross stays available and separately labelled.
   - `priceSource`, `priceAsOf`, `priceIsStale` on every valued position.
3. **Uncertainty is mandatory and is the hard part.** A position with no price, a stale price,
   an unknown cost basis, or a missing FX rate must not produce a confident return. Each derived
   field is `null` with a stated reason rather than `0`, following the `costIsUnknown` and
   `totalsAreUncertain` patterns already in this module. A test must cover: no price available,
   stale price, unknown cost basis, and a position whose trade currency differs from the
   reporting currency with no rate.
4. Replace the overview's "Not derivable" return KPI (Task 6 chose that deliberately, correctly,
   because no price source existed) with the real net return — still labelled net-of-all-costs,
   still showing gross separately, and still degrading to the uncertainty marker when inputs are
   missing.
5. Verify: tests pass, `build` and `typecheck` pass.

---

## Done when

- No file in `apps/web` references `demo-portfolio` or an undefined CSS variable.
- `globals.css` is three import lines.
- Every sidebar entry resolves to a real page; none point at an API route.
- Every displayed number traces to ledger replay.
- `pnpm --filter @stonks/web build`, `typecheck`, and `pnpm test` all pass.
