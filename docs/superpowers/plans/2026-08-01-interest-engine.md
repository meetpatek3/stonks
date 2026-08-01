# Interest Engine + Use Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model daily interest on credit-facility **use-slice** parallel balances (benchmark ± spread, ACT day-count), and report variance against actual `INTEREST_CHARGED` journals — without letting the model mutate books.

**Architecture:** Pure domain in `@stonks/ledger`: fold journals into per-facility use-slice balances, accrue daily interest so slice interest sums exactly to whole-facility interest at the same rate, then compare modelled totals to posted actuals. `@stonks/db` adds benchmark rates + facility terms tables (and optional `interest_model_run` persistence). Dollar-day attribution to positions is **Plan 4** (out of scope).

**Tech Stack:** TypeScript (strict), Vitest + fast-check, existing Money/`Journal` types, Drizzle + Postgres for terms/benchmarks. No new runtime deps.

**Spec:** [`docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md`](../specs/2026-08-01-portfolio-tracker-design.md) §4.5 facility use, §4.9 interest, §5.1–5.2 / §5.4 schema, §6 invariants 6 & 10, §7 pipeline “interest model per use-slice (+ variance vs actual)”.

## Global Constraints

- Money is `bigint` minor units only — no IEEE floats for rates applied to balances (rate is integer basis points; accrual uses integer `mulDiv`).
- **Actual `INTEREST_CHARGED` always wins for books.** The model never inserts/updates journals; it only returns modelled amounts + variance.
- Use-slice balances are parallel: at every point after a posted journal, `sum(sliceOwed) === facilityOwed` (facility owed displayed positive = `-(debit-positive balance)`).
- Same rate on all slices ⇒ modelled interest across slices **sums exactly** to modelled interest on the whole (remainder distribution required; no silent dust).
- Facility draws still require `facilityUses` covering 100% (existing invariant).
- Repayments (facility liability decrease) without `facilityUses`: allocate **proportionally** to current positive slice owed balances (largest-remainder), so slices stay consistent.
- `packages/ledger` must not import React, Next, Drizzle, or HeroUI.
- Capitalize vs pay-separately affects how **actual** journals are recorded by the user/import; the model reports accrual regardless. Auto-generating capitalize journals is out of scope (may return a suggestion DTO later — not in this plan).
- Holiday calendars / weekend posting shifts: support a simple `postingDayRule` of `CALENDAR_DAY` (accrue every calendar day in range) for the model period; `MONTH_END` only affects optional `suggestedPostDate` on the period result, not the accrual math in this phase.
- Dollar-day position attribution — Plan 4.

## Roadmap context

| Plan | Status |
|------|--------|
| Plan 1 — Ledger foundation | Done |
| Plan 2 — Positions + ACB/FIFO | Separate PR |
| **This plan** | Interest engine + use slices + variance |
| Plan 4 | Dollar-day attribution + FX gain decomposition |

---

## File structure (this phase)

```text
packages/ledger/
  src/
    money/rationals.ts                 # mulDivFloor + allocateExact (largest remainder)
    interest/
      types.ts                         # DayCount, FacilityTerms, BenchmarkCurve, …
      day-count.ts
      use-slices.ts                    # fold journals → daily slice balances
      accrue.ts                        # daily interest + period model
      variance.ts                      # modelled vs actual INTEREST_CHARGED
    index.ts
  tests/
    rationals-interest.test.ts
    day-count.test.ts
    use-slices.test.ts
    interest-accrue.test.ts
    interest-variance.test.ts
    interest.property.test.ts
fixtures/interest/
  facility-draw-repay-month.json
packages/db/
  src/schema/
    benchmark_rate.ts
    credit_facility_terms.ts
    interest_model_run.ts
  drizzle/0001_*.sql
```

---

### Task 1: Integer helpers (mulDiv + exact allocation)

**Files:**
- Create: `packages/ledger/src/money/rationals.ts`
- Create: `packages/ledger/tests/rationals-interest.test.ts`
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**
- Produces:

```ts
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint;

/** Split `total` into `weights.length` parts proportional to weights; parts sum to `total` exactly. */
export function allocateExact(total: bigint, weights: readonly bigint[]): bigint[];
```

`allocateExact` rules:
- Ignore negative weights (throw). Zero weights get 0.
- If all weights 0 and total 0 → all zeros; if all weights 0 and total ≠ 0 → throw.
- Use floor of `total * w_i / sumW`, then distribute leftover +1 to largest fractional remainders (Hamilton method).

- [ ] **Step 1: Write failing tests** for mulDivFloor + allocateExact (including exact sum and leftover distribution)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `rationals.ts` and export**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ledger): bigint mulDiv and exact proportional allocation"
```

---

### Task 2: Day-count conventions

**Files:**
- Create: `packages/ledger/src/interest/types.ts`
- Create: `packages/ledger/src/interest/day-count.ts`
- Create: `packages/ledger/tests/day-count.test.ts`

**Interfaces:**

```ts
export type DayCount = "ACT_365" | "ACT_360" | "ACT_ACT";

/** Days in the year divisor for `date` under the convention (ACT/ACT uses that date's year). */
export function dayCountDenominator(dayCount: DayCount, date: string /* YYYY-MM-DD */): bigint;

/** Inclusive start, exclusive end — number of calendar accrual days. */
export function calendarDaysBetween(startDate: string, endDate: string): number;

export function addCalendarDays(date: string, days: number): string;
```

- ACT/365 → `365n`
- ACT/360 → `360n`
- ACT/ACT → `366n` if year leap else `365n` (use UTC date parse of `YYYY-MM-DD`)

- [ ] **Step 1: Write failing tests** (leap year 2024-06-01 → 366; 2025 → 365; days between)

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -am "feat(ledger): ACT day-count helpers for interest"
```

---

### Task 3: Use-slice balance fold

**Files:**
- Create: `packages/ledger/src/interest/use-slices.ts`
- Create: `packages/ledger/tests/use-slices.test.ts`
- Create: `fixtures/interest/facility-draw-repay-month.json`

**Interfaces:**

```ts
export type FacilityUse = "INVESTMENT" | "LENDING" | "PERSONAL" | "OTHER"; // re-export from ledger types

export type UseSliceBalances = Record<FacilityUse, bigint>; // owed minor (>=0 display); missing keys = 0

export type FacilitySliceState = {
  facilityAccountId: AccountId;
  /** Debit-positive balance of facility account (typically <= 0 when drawn). */
  facilityBalanceMinor: bigint;
  /** Parallel owed by use; sum === -facilityBalanceMinor when balance <= 0, else 0 slices if overpaid edge. */
  slices: UseSliceBalances;
};

export function emptyFacilitySliceState(facilityAccountId: AccountId): FacilitySliceState;

/**
 * Apply one posted journal's effect on the facility + slices.
 * - Draw (facility posting minor < 0): require facilityUses; add each use amount to slices; facilityBalance += posting.
 * - Repay / interest capitalize affecting facility: facilityBalance += posting minor.
 *   If facilityUses present on repay, subtract those owed amounts from slices (must match repay magnitude).
 *   Else allocate repay (-delta on owed) across slices via allocateExact on current slice weights.
 * - INTEREST_CHARGED capitalize: facility posting more negative increases owed; without uses, allocateExact across existing slice weights (or put 100% into OTHER if all slices 0 — prefer require at least one slice or use OTHER).
 */
export function applyFacilityJournal(
  state: FacilitySliceState,
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
): FacilitySliceState;

/** Replay sorted journals; keep only effects for this facility account. */
export function replayFacilitySlices(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  facilityAccountId: AccountId,
): FacilitySliceState;
```

Worked fixture narrative (CAD minors):
1. Draw 1000_00 all `INVESTMENT` → facilityBalance -100000, slices.INVESTMENT 100000  
2. Draw 500_00 `PERSONAL` → facility -150000; INVESTMENT 100000, PERSONAL 50000  
3. Repay 600_00 no uses → allocateExact(60000, [100000,50000,…]) → INVESTMENT pays 40000, PERSONAL 20000 → slices 60000 / 30000; facility -90000  

Invariant after each journal: `sum(slices) === max(0, -facilityBalanceMinor)`.

- [ ] **Step 1: Write failing tests + fixture**

- [ ] **Step 2: Implement fold**

- [ ] **Step 3: PASS + commit**

```bash
git commit -am "feat(ledger): credit-facility use-slice balance fold"
```

---

### Task 4: Benchmark curve + daily / period accrual

**Files:**
- Create: `packages/ledger/src/interest/types.ts` (extend)
- Create: `packages/ledger/src/interest/accrue.ts`
- Create: `packages/ledger/tests/interest-accrue.test.ts`
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**

```ts
export type BenchmarkRatePoint = {
  effectiveDate: string; // YYYY-MM-DD inclusive
  rateBps: number; // integer basis points, e.g. 500 = 5.00%
};

export type FacilityTerms = {
  facilityAccountId: AccountId;
  spreadBps: number; // integer; may be negative
  dayCount: DayCount;
  /** Model posts suggestion only; accrual still daily. */
  postingDayRule: "CALENDAR_DAY" | "MONTH_END";
  capitalizeInterest: boolean;
};

export type InterestDaySlice = {
  date: string;
  owedByUse: UseSliceBalances;
  interestByUse: UseSliceBalances;
  interestTotalMinor: bigint;
  annualRateBps: number; // benchmark + spread that day
};

export type InterestModelResult = {
  facilityAccountId: AccountId;
  periodStart: string; // inclusive
  periodEnd: string;   // exclusive
  modelledByUse: UseSliceBalances;
  modelledTotalMinor: bigint;
  days: InterestDaySlice[]; // optional detail; include for tests
  suggestedPostDate: string; // periodEnd - 1 day, or month-end of last month in range if MONTH_END
};

/** Resolve benchmark bps on date: latest point with effectiveDate <= date; throw if none. */
export function rateBpsOnDate(curve: readonly BenchmarkRatePoint[], date: string): number;

/**
 * Accrue for each calendar day d in [periodStart, periodEnd):
 * closing owed slices = state after all journals with tradeDate <= d (end-of-day).
 * interestTotal = mulDivFloor(totalOwed, annualRateBps, 10000n * dayCountDenominator)
 * interestByUse = allocateExact(interestTotal, weights=owedByUse)
 */
export function modelInterest(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<AccountId, Account>;
  terms: FacilityTerms;
  benchmarkCurve: readonly BenchmarkRatePoint[];
  periodStart: string;
  periodEnd: string;
}): InterestModelResult;
```

Hand-calc test (ACT/365):
- Constant owed 1000_00, rate 365 bps (3.65% → nice daily 0.01%):  
  `daily = mulDivFloor(100000, 365n, 10000n * 365n) = mulDivFloor(100000, 1n, 10000n) = 10` minor per day ($0.10).  
- 10 days → modelled 100 minor.

Two-slice same total: INVESTMENT 60000 + PERSONAL 40000 = 100000 → daily total 10; allocateExact(10,[60000,40000]) → 6+4; property sum.

- [ ] **Step 1: Failing accrue tests**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -am "feat(ledger): daily use-slice interest model"
```

---

### Task 5: Variance vs actual INTEREST_CHARGED

**Files:**
- Create: `packages/ledger/src/interest/variance.ts`
- Create: `packages/ledger/tests/interest-variance.test.ts`

**Interfaces:**

```ts
export type InterestVariance = {
  facilityAccountId: AccountId;
  periodStart: string;
  periodEnd: string;
  modelledTotalMinor: bigint;
  modelledByUse: UseSliceBalances;
  /** Sum of -facility posting minors on INTEREST_CHARGED journals in [start, end) (owed increase). */
  actualPostedMinor: bigint;
  /** modelled - actual */
  varianceMinor: bigint;
  actualJournalIds: string[];
};

export function actualInterestCharged(args: {
  journals: readonly Journal[];
  accounts: ReadonlyMap<AccountId, Account>;
  facilityAccountId: AccountId;
  periodStart: string;
  periodEnd: string;
}): { actualPostedMinor: bigint; actualJournalIds: string[] };

export function interestVariance(
  model: InterestModelResult,
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
): InterestVariance;
```

- [ ] **Step 1: Tests** — model 100, actual INTEREST_CHARGED 90 → variance 10; actual wins conceptually (books unchanged)

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(ledger): interest model variance vs actual charges"
```

---

### Task 6: Property tests

**Files:**
- Create: `packages/ledger/tests/interest.property.test.ts`
- Modify: `packages/ledger/src/testing/arbitrary.ts` (facility draw/repay chain arb)

**Properties:**
1. After every journal in a generated draw/repay chain, `sum(slices) === max(0n, -facilityBalance)`.
2. For each accrued day, `sum(interestByUse) === interestTotalMinor`.
3. Period `modelledTotalMinor === sum(days.interestTotalMinor)`.
4. Changing only slice mix (same total owed path) does not change `modelledTotalMinor` when rate/day-count identical (generate single-slice vs split that sums equal).

- [ ] **Step 1–4: Write arbs, tests, fix until PASS, commit**

```bash
git commit -am "test(ledger): property tests for use-slice interest invariants"
```

---

### Task 7: DB schema — benchmarks, terms, model runs

**Files:**
- Create: `packages/db/src/schema/benchmark_rate.ts`
- Create: `packages/db/src/schema/credit_facility_terms.ts`
- Create: `packages/db/src/schema/interest_model_run.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generate migration `packages/db/drizzle/0001_*.sql`
- Optional smoke: extend integration test or add schema-only generate check

**Schema (match design):**

```ts
// benchmark_rate(id, name)
// benchmark_rate_point(benchmark_id, effective_date, rate_bps) PK (benchmark_id, effective_date)
// credit_facility_terms(id, account_id, benchmark_id, spread_bps, day_count, posting_day_rule, capitalize_interest, effective_from, effective_to)
// interest_model_run(id, facility_account_id, period_start, period_end, modelled_minor, actual_posted_minor, variance_minor, modelled_by_use jsonb, created_at)
```

- [ ] **Step 1: Write drizzle schema modules**

- [ ] **Step 2: `pnpm --filter @stonks/db generate` (or hand-write SQL consistent with drizzle meta)**

- [ ] **Step 3: Migrate against Docker Postgres if available; otherwise commit SQL + ensure `generate` output is valid**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(db): benchmark rates, facility terms, interest_model_run"
```

---

### Task 8: README + Phase 3 DoD

**Files:**
- Modify: `README.md`
- Modify: this plan’s DoD checkboxes as tasks complete

- [ ] **Step 1: Link plan + Phase 3 checklist in README**

- [ ] **Step 2: Commit + push**

```bash
git commit -am "docs: interest engine plan and Phase 3 checklist"
```

---

## Phase 3 definition of done

- [x] Use-slice fold keeps `sum(slices) === owed` after draws/repays
- [x] Daily accrual fixture matches hand calculation
- [x] Slice interest sums exactly to total each day (unit + property)
- [x] Variance = modelled − actual `INTEREST_CHARGED` for period
- [x] DB migration for benchmarks / terms / interest_model_run
- [x] No float money paths in interest code

## Self-review (plan author)

1. **Spec coverage:** §4.9 daily accrual, benchmark±spread, day-count, actual wins, use-slice parallel balances, invariant 10 — covered. Holiday posting shifts deferred to simple `suggestedPostDate`. Dollar-days → Plan 4. Auto capitalize journal emission → out of scope.
2. **Placeholders:** None; formulas and signatures concrete.
3. **Types:** `FacilityTerms`, `InterestModelResult`, `InterestVariance`, `UseSliceBalances`, `allocateExact` consistent across tasks.
