# Positions + ACB/FIFO Cost Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive per-account security positions with dual-currency cost basis using ACB and FIFO, including realized gains on sells, from the existing deterministic journal replay — with hand-calculated fixtures and property tests.

**Architecture:** Extend pure `@stonks/ledger` domain only. Cost basis folds in the same `(trade_date, sort_key, id)` order as balances/quantities. `LedgerState` gains a `positions` map keyed by `accountId:securityId`. ACB keeps aggregate qty + total cost (trade + reporting). FIFO keeps ordered lots. Unknown cost, openings, and corporate actions stay out of scope (Plan 5). Interest/FX decomposition stay out of scope (Plans 3–4).

**Tech Stack:** TypeScript (strict), Vitest + fast-check, existing `@stonks/ledger` Money/Quantity/Journal types. No new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md`](../specs/2026-08-01-portfolio-tracker-design.md) §4.6, §4.11 (dual currency tracking only — not FX gain split), §6 invariants 2–3, §7 pipeline step “positions + cost basis”, §9 worked examples.

## Global Constraints

- Money never uses IEEE binary floats — integer minor units (`bigint`) in domain.
- Quantities use fixed scale 8 (`QUANTITY_SCALE`); no `Number`/`parseFloat` on money or qty value paths.
- Cost allocation uses integer `mulDiv` with a defined remainder rule so full disposal clears cost exactly (no dust).
- Positions are derived by replaying `POSTED` journals ordered by `(trade_date, sort_key, id)` — same as balances.
- Negative quantity remains a hard `ValidationError` (`NEGATIVE_QUANTITY`); never reorder to “fix” it.
- Never invent cost: this phase only handles security legs with known monetary amounts on the security posting. Missing trade-currency fields default to reporting currency (same minor amount) — not to zero inventing of cost when the security leg has no amount (reject instead).
- `packages/ledger` must not import React, Next, Drizzle, or HeroUI.
- Unknown cost basis (`CostBasisState = Unknown`), opening journals without cost, in-kind transfers, ROC, splits — deferred to Plan 5.
- FX gain decomposition (asset vs currency movement) — deferred to Plan 4; this plan tracks trade + reporting costs/proceeds/gains as totals only.
- Debit-positive convention unchanged: security acquire legs have `quantity > 0` and typically `amount.minor > 0` (cost into the asset); dispose legs have `quantity < 0` and `amount.minor` = −proceeds (asset decrease).

## Roadmap context

| Plan | Status |
|------|--------|
| Plan 1 — Ledger foundation | Done |
| **This plan** | Positions + ACB/FIFO (trade + reporting currency) |
| Plan 3 | Interest engine + use slices |
| Plan 4 | Dollar-day attribution + FX gain decomposition |
| Plan 5 | Openings, unknown cost, corporate actions |
| Plans 6–9 | Tax, import, UI, market data |

---

## File structure (this phase)

```text
packages/ledger/
  src/
    money/
      rationals.ts              # bigint mulDiv helpers
    ledger/
      positions.ts              # Position types, ACB/FIFO apply
      replay.ts                 # wire positions into applyJournal/replay
      types.ts                  # CostBasisMethod on replay options (or household-less param)
    index.ts
  tests/
    mul-div.test.ts
    positions-acb.test.ts
    positions-fifo.test.ts
    positions-dual-currency.test.ts
    positions.property.test.ts
fixtures/ledger/
  acb-cad-roundtrip.json
  fifo-cad-roundtrip.json
  dual-currency-usd-cad.json
```

---

### Task 1: Integer mulDiv helpers

**Files:**
- Create: `packages/ledger/src/money/rationals.ts`
- Create: `packages/ledger/tests/mul-div.test.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/tests/mul-div.test.ts`

**Interfaces:**
- Consumes: none (pure bigint)
- Produces:

```ts
/** Floor-divide (a * b) / d for non-negative a,b,d with d > 0. */
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint;

/**
 * Allocate `total` across a removal of `take` out of `whole` (all > 0, take <= whole).
 * Uses floor for partial; when take === whole, returns `total` exactly (clears dust).
 */
export function allocateCost(total: bigint, take: bigint, whole: bigint): bigint;
```

- [ ] **Step 1: Write failing tests**

```ts
// packages/ledger/tests/mul-div.test.ts
import { describe, it, expect } from "vitest";
import { mulDivFloor, allocateCost } from "../src/index.js";

describe("mulDivFloor", () => {
  it("multiplies then divides with floor", () => {
    expect(mulDivFloor(10n, 3n, 2n)).toBe(15n);
    expect(mulDivFloor(100n, 1n, 3n)).toBe(33n);
  });

  it("rejects non-positive divisor", () => {
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow(/divisor/i);
  });
});

describe("allocateCost", () => {
  it("floors partial allocation", () => {
    // total 1000, take 1 of 3 → 333
    expect(allocateCost(1000n, 1n, 3n)).toBe(333n);
  });

  it("returns full total when take equals whole", () => {
    expect(allocateCost(1000n, 3n, 3n)).toBe(1000n);
    // even if floor would have left remainder across steps
    expect(allocateCost(100n, 3n, 3n)).toBe(100n);
  });

  it("rejects take > whole", () => {
    expect(() => allocateCost(100n, 4n, 3n)).toThrow(/take/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @stonks/ledger test mul-div`
Expected: FAIL (exports missing)

- [ ] **Step 3: Implement**

```ts
// packages/ledger/src/money/rationals.ts
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Divisor must be positive");
  if (a < 0n || b < 0n) throw new Error("mulDivFloor requires non-negative operands");
  return (a * b) / d;
}

export function allocateCost(total: bigint, take: bigint, whole: bigint): bigint {
  if (whole <= 0n) throw new Error("whole must be positive");
  if (take < 0n) throw new Error("take must be non-negative");
  if (take > whole) throw new Error("take exceeds whole");
  if (total < 0n) throw new Error("total must be non-negative");
  if (take === 0n) return 0n;
  if (take === whole) return total;
  return mulDivFloor(total, take, whole);
}
```

Export from `src/index.ts`.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @stonks/ledger test mul-div`

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/money/rationals.ts packages/ledger/tests/mul-div.test.ts packages/ledger/src/index.ts
git commit -m "feat(ledger): add bigint mulDiv and allocateCost helpers"
```

---

### Task 2: Position types + security-leg cost extraction

**Files:**
- Create: `packages/ledger/src/ledger/positions.ts`
- Create: `packages/ledger/tests/positions-extract.test.ts`
- Modify: `packages/ledger/src/ledger/errors.ts` (add codes)
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**
- Consumes: `Money`, `Quantity`, `Posting`, `JournalId`, `AccountId`, `SecurityId`
- Produces:

```ts
export type CostBasisMethod = "ACB" | "FIFO";

export type FifoLot = {
  readonly acquiredJournalId: JournalId;
  readonly quantity: Quantity; // > 0
  readonly costTradeMinor: bigint; // >= 0, trade currency minor units
  readonly costReportingMinor: bigint; // >= 0, reporting currency minor units
};

export type Position = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly quantity: Quantity;
  readonly tradeCurrency: string;
  readonly method: CostBasisMethod;
  /** ACB aggregate; unused (0) under FIFO except as cache optional — keep for ACB */
  readonly acbCostTradeMinor: bigint;
  readonly acbCostReportingMinor: bigint;
  readonly lots: readonly FifoLot[]; // FIFO only; empty for ACB
};

export type RealizedGain = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly journalId: JournalId;
  readonly quantitySold: Quantity; // positive magnitude
  readonly tradeCurrency: string;
  readonly proceedsTradeMinor: bigint;
  readonly proceedsReportingMinor: bigint;
  readonly costTradeMinor: bigint;
  readonly costReportingMinor: bigint;
  readonly gainTradeMinor: bigint; // proceeds - cost
  readonly gainReportingMinor: bigint;
  readonly sourceJournalIds: string[]; // acquire lot journal ids + sell id
};

export type SecurityLeg = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly quantity: Quantity; // signed
  readonly tradeCurrency: string;
  readonly tradeAmountMinor: bigint; // signed same sign as cash effect on position cost/proceeds
  readonly reportingAmountMinor: bigint; // posting.amount.minor (signed)
};

/** Extract security legs; throw MISSING_COST if qty present without usable amounts. */
export function extractSecurityLegs(postings: readonly Posting[]): SecurityLeg[];
```

Rules for extraction:
- Skip postings without both `securityId` and `quantity`.
- `reportingAmountMinor = posting.amount.minor` (required; always present on `Posting`).
- If `tradeCurrency` + `tradeAmountMinor` set, use them; else `tradeCurrency = posting.amount.currency` and `tradeAmountMinor = posting.amount.minor`.
- If `tradeCurrency` set without `tradeAmountMinor` (or vice versa), throw `ValidationError` code `MISSING_COST`.

Extend `ValidationError` codes with `"MISSING_COST" | "COST_CURRENCY"`.

- [ ] **Step 1: Write failing extract tests**

```ts
import { describe, it, expect } from "vitest";
import { CAD, USD, money, qtyFromDecimalString, extractSecurityLegs, ValidationError } from "../src/index.js";

describe("extractSecurityLegs", () => {
  it("defaults trade fields to reporting when omitted", () => {
    const legs = extractSecurityLegs([
      {
        accountId: "inv",
        amount: money(CAD, 1000n),
        quantity: qtyFromDecimalString("10"),
        securityId: "AAPL",
      },
      { accountId: "cash", amount: money(CAD, -1000n) },
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      tradeCurrency: "CAD",
      tradeAmountMinor: 1000n,
      reportingAmountMinor: 1000n,
    });
  });

  it("keeps explicit trade currency amounts", () => {
    const legs = extractSecurityLegs([
      {
        accountId: "inv",
        amount: money(CAD, 13500n), // CAD reporting
        quantity: qtyFromDecimalString("10"),
        securityId: "AAPL",
        tradeCurrency: "USD",
        tradeAmountMinor: 10000n,
      },
    ]);
    expect(legs[0]?.tradeCurrency).toBe("USD");
    expect(legs[0]?.tradeAmountMinor).toBe(10000n);
    expect(legs[0]?.reportingAmountMinor).toBe(13500n);
  });

  it("rejects partial trade fields", () => {
    expect(() =>
      extractSecurityLegs([
        {
          accountId: "inv",
          amount: money(CAD, 1000n),
          quantity: qtyFromDecimalString("1"),
          securityId: "X",
          tradeCurrency: "USD",
          // tradeAmountMinor missing
        },
      ]),
    ).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement types + `extractSecurityLegs` in `positions.ts`; extend error codes**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): position types and security-leg cost extraction"
```

---

### Task 3: ACB acquire + dispose

**Files:**
- Modify: `packages/ledger/src/ledger/positions.ts`
- Create: `packages/ledger/tests/positions-acb.test.ts`
- Create: `fixtures/ledger/acb-cad-roundtrip.json`
- Test: `packages/ledger/tests/positions-acb.test.ts`

**Interfaces:**
- Consumes: `allocateCost`, `extractSecurityLegs`, qty helpers, money helpers
- Produces:

```ts
export type PositionState = {
  positions: Map<string, Position>; // key = positionKey(accountId, securityId)
  realized: RealizedGain[]; // append-only across replay
};

export function emptyPositionState(): PositionState;

export function applyPositionsForJournal(
  state: PositionState,
  journal: { id: string; postings: Posting[] },
  method: CostBasisMethod,
): PositionState;
```

ACB rules:
- **Acquire** (`quantity.scaled > 0`):  
  - costTrade = `tradeAmountMinor` (must be ≥ 0; if negative throw `COST_CURRENCY` / message about acquire sign)  
  - costReporting = `reportingAmountMinor` (must be ≥ 0)  
  - newQty = old + qty; newAcbTrade = old + costTrade; same for reporting  
  - `lots` stays `[]`  
  - tradeCurrency must match existing position tradeCurrency if position exists
- **Dispose** (`quantity.scaled < 0`):  
  - sellQty = −quantity  
  - proceedsTrade = −tradeAmountMinor (so sell leg with tradeAmountMinor −500 → proceeds 500)  
  - proceedsReporting = −reportingAmountMinor  
  - Both proceeds must be ≥ 0  
  - costTrade = `allocateCost(acbCostTrade, sellQty.scaled, oldQty.scaled)`  
  - costReporting = `allocateCost(acbCostReporting, sellQty.scaled, oldQty.scaled)`  
  - Reduce qty and ACB totals; if qty → 0, force ACB costs to 0  
  - Push `RealizedGain` with `sourceJournalIds: [journal.id]` (ACB has no lot ids; include sell id only — or also prior buys is optional; require at least sell journal id)
- Zero-qty legs: ignore

Worked example (CAD, hand-calculated) — store in fixture JSON and assert in test:

1. BUY 2024-01-10: 100 shares, cost 1000_00 → qty 100, ACB 1000.00  
2. BUY 2024-02-10: 100 shares, cost 1200_00 → qty 200, ACB 2200.00 (avg 11.00)  
3. SELL 2024-03-10: 100 shares, proceeds 1500_00 →  
   - cost removed = allocateCost(2200_00, 100, 200) = 1100_00  
   - gain = 1500_00 − 1100_00 = 400_00  
   - remaining qty 100, ACB 1100_00

Postings for buys/sells follow existing debit-positive tests (investment security leg carries cost/proceeds amount + qty).

- [ ] **Step 1: Write fixture + failing ACB tests**

Fixture shape (bigint fields as strings in JSON):

```json
{
  "method": "ACB",
  "reportingCurrency": "CAD",
  "narrative": "Two buys then half sell; ACB average",
  "expectedAfter": {
    "positionKey": "investment:AAPL",
    "quantity": "100.00000000",
    "acbCostReportingMinor": "110000",
    "realized": [
      {
        "journalId": "j-sell",
        "costReportingMinor": "110000",
        "proceedsReportingMinor": "150000",
        "gainReportingMinor": "40000"
      }
    ]
  }
}
```

Test builds journals in code (or loads fixture journals) and calls `applyPositionsForJournal` in order with `method: "ACB"`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement ACB branch of `applyPositionsForJournal`**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/ledger fixtures/ledger
git commit -m "feat(ledger): ACB cost basis acquire and dispose"
```

---

### Task 4: FIFO acquire + dispose

**Files:**
- Modify: `packages/ledger/src/ledger/positions.ts`
- Create: `packages/ledger/tests/positions-fifo.test.ts`
- Create: `fixtures/ledger/fifo-cad-roundtrip.json`

**Interfaces:**
- Same `applyPositionsForJournal` with `method: "FIFO"`
- Acquire: append `FifoLot { acquiredJournalId, quantity, costTradeMinor, costReportingMinor }`
- Dispose: consume lots oldest-first; for each lot take `min(remainingSell, lot.qty)`; cost via `allocateCost` within the lot; when lot fully consumed drop it; when partial, shrink lot qty and costs
- `acbCostTradeMinor` / `acbCostReportingMinor` on FIFO positions: maintain as sum of lot costs for convenience (or leave 0 and compute when needed — **prefer maintain as sum** so reads are uniform)
- Realized gain may span multiple lots; one `RealizedGain` per sell journal aggregating costs/proceeds; `sourceJournalIds` = unique acquire journal ids consumed + sell id

Worked example (same buys as ACB):
1. BUY 100 @ 1000.00 lot1  
2. BUY 100 @ 1200.00 lot2  
3. SELL 100 @ 1500.00 → consumes lot1 entirely; cost 1000.00; gain 500.00; remaining lot2 100 @ 1200.00

- [ ] **Step 1: Write failing FIFO tests + fixture**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement FIFO branch**

- [ ] **Step 4: Run — PASS** (also re-run ACB tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ledger fixtures/ledger
git commit -m "feat(ledger): FIFO lot-based cost basis"
```

---

### Task 5: Dual-currency (USD trade / CAD reporting)

**Files:**
- Create: `packages/ledger/tests/positions-dual-currency.test.ts`
- Create: `fixtures/ledger/dual-currency-usd-cad.json`
- Modify: `packages/ledger/src/ledger/positions.ts` if trade-currency mismatch checks need tightening

**Interfaces:**
- Consumes: existing apply + extract
- Produces: verified dual-currency ACB behavior

Worked example (hand-calculated):
1. BUY 10 shares: trade USD 100.00 (`tradeAmountMinor=10000`), reporting CAD 135.00 (`amount.minor=13500`)  
2. BUY 10 shares: trade USD 110.00, reporting CAD 148.00 → ACB trade 210.00, reporting 283.00  
3. SELL 10 shares: trade proceeds USD 120.00, reporting CAD 160.00 →  
   - costTrade = allocateCost(21000, 10e8, 20e8) = 10500  
   - costReporting = allocateCost(28300, 10e8, 20e8) = 14150  
   - gainTrade = 12000 − 10500 = 1500  
   - gainReporting = 16000 − 14150 = 1850  

Also: selling with mismatched `tradeCurrency` vs position throws `COST_CURRENCY`.

- [ ] **Step 1: Write failing dual-currency tests**

- [ ] **Step 2: Run — FAIL** (if any gap)

- [ ] **Step 3: Fix implementation until PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/ledger fixtures/ledger
git commit -m "test(ledger): dual-currency ACB worked example"
```

---

### Task 6: Wire positions into ledger replay

**Files:**
- Modify: `packages/ledger/src/ledger/replay.ts`
- Modify: `packages/ledger/tests/replay.test.ts` (assert empty positions still ok)
- Create: `packages/ledger/tests/replay-positions.test.ts`
- Modify: `packages/ledger/src/index.ts` exports

**Interfaces:**
- Consumes: `applyPositionsForJournal`, `emptyPositionState`
- Produces:

```ts
export type LedgerState = {
  balances: Map<AccountId, Money>;
  quantities: Map<string, Quantity>;
  positions: Map<string, Position>;
  realized: RealizedGain[];
  ledgerVersion: number;
};

export type ReplayOptions = {
  costBasisMethod?: CostBasisMethod; // default "ACB"
};

export function emptyLedgerState(reportingCurrency: string): LedgerState;

export function applyJournal(
  state: LedgerState,
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
  options?: ReplayOptions,
): LedgerState;

export function replay(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  reportingCurrency: string,
  options?: ReplayOptions,
): LedgerState;
```

Rules:
- After quantity fold succeeds, run `applyPositionsForJournal` with `options?.costBasisMethod ?? "ACB"`.
- Keep `quantities` map in sync with existing behavior (do not remove; positions.quantity must match quantities for each key after apply).
- Existing tests that ignore new fields must still pass (`exactOptionalPropertyTypes` friendly).

- [ ] **Step 1: Write failing replay-positions test** (ACB fixture through `replay`)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Extend `LedgerState` + wire apply/replay**

- [ ] **Step 4: Run full package tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): derive positions and realized gains in replay"
```

---

### Task 7: Property tests for cost-basis invariants

**Files:**
- Create: `packages/ledger/tests/positions.property.test.ts`
- Modify: `packages/ledger/src/testing/arbitrary.ts` (generators for buy/sell chains)

**Interfaces:**
- Produces fast-check properties:
  1. For any valid chain of buys then sells that never oversell, final `position.quantity` equals sum of buy qtys − sell qtys  
  2. Under ACB and FIFO, after **full** disposal of a position, no position entry remains and sum of realized `costReportingMinor` equals sum of buy reporting costs  
  3. For every `RealizedGain`, `gainReportingMinor === proceedsReportingMinor - costReportingMinor` (exact)  
  4. `quantities.get(key)?.scaled === positions.get(key)?.quantity.scaled` when either exists  
  5. ACB vs FIFO may differ on partial sells (assert at least one generated case where gains differ when prices differ across lots) — optional soft check; if hard to generate, skip and document in test name as example unit test instead

- [ ] **Step 1: Write property tests**

- [ ] **Step 2: Run — FAIL until arbs exist**

- [ ] **Step 3: Implement arbs + fix bugs**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/ledger
git commit -m "test(ledger): property tests for ACB/FIFO cost invariants"
```

---

### Task 8: Docs — README phase checklist + plan DoD

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-01-positions-cost-basis.md` (this file; checkboxes updated as tasks complete)

**Interfaces:**
- Documents Phase 2 definition of done in README alongside Phase 1

- [ ] **Step 1: Update README**

Add documentation row for this plan and a Phase 2 definition of done:

- [ ] ACB worked fixture matches hand calculation  
- [ ] FIFO worked fixture matches hand calculation  
- [ ] Dual-currency ACB fixture matches hand calculation  
- [ ] Replay exposes `positions` + `realized`  
- [ ] Property tests green  
- [ ] No `number` for money/qty/cost paths in new code  

- [ ] **Step 2: Commit**

```bash
git add README.md docs/superpowers/plans/2026-08-01-positions-cost-basis.md
git commit -m "docs: positions/cost-basis plan and Phase 2 checklist"
```

---

## Phase 2 definition of done

- [ ] `@stonks/ledger` ACB unit tests + fixture green
- [ ] FIFO unit tests + fixture green
- [ ] Dual-currency worked example green
- [ ] `replay` returns positions and realized gains
- [ ] Property tests for cost identity / qty sync green
- [ ] No `number` used for money, quantities, or cost allocations in new ledger code

## Self-review (plan author)

1. **Spec coverage (phase 2 slice):** §4.6 ACB + FIFO, dual currency cost tracking, path-dependent buys/sells, deterministic order via existing replay — covered. Unknown cost, openings, corporate actions (§4.7/4.12) deferred to Plan 5. FX decomposition (§4.11 second bullet) deferred to Plan 4. Dollar-day / interest not in scope.
2. **Placeholder scan:** None; tasks include concrete formulas, fixtures, and signatures.
3. **Type consistency:** `CostBasisMethod`, `Position`, `FifoLot`, `RealizedGain`, `PositionState`, `ReplayOptions`, `allocateCost`, `applyPositionsForJournal` names are stable across tasks. `LedgerState` extension additive for existing balance/qty tests.
