# Entry Form Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fast Entry’s single From/To form with type-specific fields that match how users record deposits, transfers, buys, sells, income, fees, and openings — including cash/position checks and a guided transfer when a buy is short cash.

**Architecture:** Pure posting builders + sufficiency helpers in `apps/web/lib/` (unit-tested). `loadEntryFormData` gains balances, positions, and known security ids from the household snapshot. `EntryScreen` becomes adaptive (one screen, fields swap by type) and posts via existing `POST /api/journals`. No facility-funded BUY path; no CORPORATE_ACTION create UI.

**Tech Stack:** Next.js 15 App Router, HeroUI v3 / HeroUI Pro, Vitest, `@stonks/ledger` (`bigint` money + qty strings), existing journal create API.

**Spec:** [`docs/superpowers/specs/2026-08-05-entry-form-and-facility-terms-design.md`](../specs/2026-08-05-entry-form-and-facility-terms-design.md) Part A.

**Sibling plan:** Facility terms on Accounts is a separate plan — do not implement Part B here.

## Global Constraints

- Never use JS `number` for money/qty/cost paths — minor units as `bigint` / wire strings; quantities via `qtyFromDecimalString` / decimal strings.
- Journals are immutable; this form only creates POSTED manuals.
- SELL security-leg quantity and proceeds must be **negative** on the wire; UI shows positive “qty sold”.
- BUY/SELL require security + quantity; funding cash for BUY is the **same** brokerage account (same-account cash + security postings).
- UI may block cash-negative outflow and oversell; do **not** add a global API ban on negative cash.
- `apps/web/app/globals.css` stays three imports only — no custom CSS.
- Prefer HeroUI components already used in `entry-screen.tsx` / `accounts-screen.tsx`.
- Do not preserve obsolete From/To-for-everything paths with compatibility shims — replace them.

---

## File structure

```text
apps/web/
  lib/
    journals.ts                         # keep createPostedJournal; add/replace builders
    entry-postings.ts                   # NEW: per-type posting builders (pure)
    entry-sufficiency.ts                # NEW: cash shortfall + position qty checks
    portfolio.ts                        # extend loadEntryFormData
  components/
    entry-screen.tsx                    # rewrite adaptive form
  app/(app)/entry/page.tsx              # pass new props
  tests/
    entry-postings.test.ts              # NEW
    entry-sufficiency.test.ts           # NEW
    journals-api.test.ts                # existing; leave unless create API needs OPENING
```

---

### Task 1: Per-type posting builders

**Files:**
- Create: `apps/web/lib/entry-postings.ts`
- Create: `apps/web/tests/entry-postings.test.ts`
- Modify: `apps/web/lib/journals.ts` — keep `decimalAmountToMinorString`, `todayIsoDate`, `mostRecentlyUsedAccountId`, `createPostedJournal`; remove or stop exporting `balancedMovePostings` / `defaultEntryAccounts` once nothing imports them (Task 4 deletes the old form).

**Interfaces:**
- Produces:

```ts
export type WirePosting = {
  accountId: string;
  amountMinor: string;
  quantity?: string;
  securityId?: string;
};

export type BuildEntryPostingsInput =
  | {
      type: "DEPOSIT" | "DIVIDEND" | "INTEREST_EARNED";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
      securityId?: string; // DIVIDEND only in practice
    }
  | {
      type: "WITHDRAWAL" | "FEE" | "INTEREST_CHARGED";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
      securityId?: string; // FEE optional
    }
  | {
      type: "TRANSFER";
      fromAccountId: string;
      toAccountId: string;
      amountMinor: bigint;
    }
  | {
      type: "BUY";
      accountId: string;
      amountMinor: bigint; // cost
      quantity: string; // positive decimal
      securityId: string;
    }
  | {
      type: "SELL";
      accountId: string;
      amountMinor: bigint; // proceeds (positive from UI)
      quantity: string; // positive decimal from UI
      securityId: string;
    }
  | {
      type: "OPENING";
      mode: "cash";
      accountId: string;
      externalAccountId: string;
      amountMinor: bigint;
    }
  | {
      type: "OPENING";
      mode: "position";
      accountId: string;
      externalAccountId: string;
      quantity: string;
      securityId: string;
      /** Omit or null = unknown cost (0/0 amounts). */
      costMinor?: bigint | null;
    };

export function buildEntryPostings(input: BuildEntryPostingsInput): WirePosting[];
```

Posting rules (debit-positive):

| Type | Legs |
|------|------|
| DEPOSIT / DIVIDEND / INTEREST_EARNED | EXTERNAL −amount; account +amount (+ optional `securityId` on the household leg for DIVIDEND/FEE attribution) |
| WITHDRAWAL / FEE / INTEREST_CHARGED | account −amount; EXTERNAL +amount |
| TRANSFER | from −; to + |
| BUY | same `accountId`: cash `−amountMinor` (no security); security leg `+amountMinor`, `quantity` positive, `securityId` |
| SELL | same `accountId`: security leg `−amountMinor`, `quantity` **negated** (prefix `-` if positive input), `securityId`; cash `+amountMinor` |
| OPENING cash | EXTERNAL −; account + |
| OPENING position + cost | EXTERNAL −cost; account +cost with qty + securityId |
| OPENING position unknown cost | EXTERNAL `0`; account `0` + qty + securityId |

- [ ] **Step 1: Write failing tests** in `apps/web/tests/entry-postings.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildEntryPostings } from "../lib/entry-postings";

describe("buildEntryPostings", () => {
  it("BUY uses same account for cash and security legs", () => {
    const legs = buildEntryPostings({
      type: "BUY",
      accountId: "broker",
      amountMinor: 100_00n,
      quantity: "10",
      securityId: "XEQT",
    });
    expect(legs).toEqual([
      { accountId: "broker", amountMinor: "-10000" },
      {
        accountId: "broker",
        amountMinor: "10000",
        quantity: "10",
        securityId: "XEQT",
      },
    ]);
  });

  it("SELL negates quantity and proceeds on the security leg", () => {
    const legs = buildEntryPostings({
      type: "SELL",
      accountId: "broker",
      amountMinor: 50_00n,
      quantity: "5",
      securityId: "XEQT",
    });
    expect(legs).toEqual([
      {
        accountId: "broker",
        amountMinor: "-5000",
        quantity: "-5",
        securityId: "XEQT",
      },
      { accountId: "broker", amountMinor: "5000" },
    ]);
  });

  it("OPENING position with unknown cost is 0/0 with quantity", () => {
    const legs = buildEntryPostings({
      type: "OPENING",
      mode: "position",
      accountId: "broker",
      externalAccountId: "ext",
      quantity: "100",
      securityId: "AAPL",
      costMinor: null,
    });
    expect(legs).toEqual([
      {
        accountId: "broker",
        amountMinor: "0",
        quantity: "100",
        securityId: "AAPL",
      },
      { accountId: "ext", amountMinor: "0" },
    ]);
  });

  it("DEPOSIT is EXTERNAL → account", () => {
    expect(
      buildEntryPostings({
        type: "DEPOSIT",
        accountId: "cash",
        externalAccountId: "ext",
        amountMinor: 1_00n,
      }),
    ).toEqual([
      { accountId: "ext", amountMinor: "-100" },
      { accountId: "cash", amountMinor: "100" },
    ]);
  });
});
```

Also cover TRANSFER, WITHDRAWAL, OPENING cash, OPENING position with cost, and DIVIDEND optional securityId on the household leg.

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @stonks/web test tests/entry-postings.test.ts
```

Expected: FAIL — cannot resolve `../lib/entry-postings` or `buildEntryPostings` missing.

- [ ] **Step 3: Implement `entry-postings.ts`** per the table above. For SELL quantity negation:

```ts
function negateQtyDecimal(qty: string): string {
  const trimmed = qty.trim();
  if (trimmed.startsWith("-")) return trimmed;
  return `-${trimmed}`;
}
```

Do not use `Number` / `parseFloat`.

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm --filter @stonks/web test tests/entry-postings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/entry-postings.ts apps/web/tests/entry-postings.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add per-type entry posting builders

Encode BUY same-account legs, SELL qty negation, and OPENING unknown cost as pure helpers.
EOF
)"
```

---

### Task 2: Cash and position sufficiency helpers

**Files:**
- Create: `apps/web/lib/entry-sufficiency.ts`
- Create: `apps/web/tests/entry-sufficiency.test.ts`

**Interfaces:**
- Consumes: balance/position shapes as wire strings (same as `BalanceRow.minor` / `PositionRow.quantity`)
- Produces:

```ts
/** Available cash in an account from replay balance minor string. */
export function cashAvailableMinor(balanceMinor: string | undefined): bigint;

/**
 * Positive shortfall when `needMinor` exceeds available cash; else 0n.
 * Liability / facility accounts are not used as BUY funding in this form —
 * callers only pass brokerage/cash account balances.
 */
export function cashShortfallMinor(
  availableMinor: bigint,
  needMinor: bigint,
): bigint;

/**
 * True when requested sell qty (positive decimal) exceeds position qty
 * (fixed-scale decimal string from PositionRow).
 */
export function exceedsPositionQty(
  positionQty: string | undefined,
  sellQtyPositive: string,
): boolean;
```

Use `qtyFromDecimalString` from `@stonks/ledger` for quantity compares (`scaled` bigint). Missing balance → available `0n`. Missing position → oversell if sell qty > 0.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  cashAvailableMinor,
  cashShortfallMinor,
  exceedsPositionQty,
} from "../lib/entry-sufficiency";

describe("entry sufficiency", () => {
  it("computes shortfall for a buy", () => {
    expect(cashAvailableMinor("50000")).toBe(50000n);
    expect(cashShortfallMinor(50000n, 80000n)).toBe(30000n);
    expect(cashShortfallMinor(50000n, 40000n)).toBe(0n);
  });

  it("detects oversell", () => {
    expect(exceedsPositionQty("10.00000000", "11")).toBe(true);
    expect(exceedsPositionQty("10.00000000", "10")).toBe(false);
    expect(exceedsPositionQty(undefined, "1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter @stonks/web test tests/entry-sufficiency.test.ts
```

- [ ] **Step 3: Implement `entry-sufficiency.ts`**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/entry-sufficiency.ts apps/web/tests/entry-sufficiency.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add entry cash and position sufficiency checks
EOF
)"
```

---

### Task 3: Enrich entry form loader (balances, positions, securities, EXTERNAL)

**Files:**
- Modify: `apps/web/lib/portfolio.ts` — `loadEntryFormData`
- Modify: `apps/web/app/(app)/entry/page.tsx` — pass new fields
- Modify: `apps/web/components/entry-screen.tsx` — extend `EntryScreenProps` (UI wiring in Task 4–5; this task only types + load)

**Interfaces:**
- Change `loadEntryFormData` return to:

```ts
{
  accounts: AccountRef[];
  /** Open non-EXTERNAL accounts only — for pickers that hide EXTERNAL. */
  householdAccounts: AccountRef[];
  externalAccountId: string | null;
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  /** accountId → balance minor string (reporting currency cash on account). */
  cashByAccountId: Record<string, string>;
  /** Open positions for the household (qty strings). */
  positions: Array<{
    accountId: string;
    securityId: string;
    quantity: string;
  }>;
  /** Distinct security ids seen on household postings, sorted. */
  securityIds: string[];
  message?: string;
}
```

Implementation notes:

1. Reuse `getPortfolioSnapshot` (or the same derive path accounts already use) for the session household to obtain `balances` + `positions`.
2. `cashByAccountId`: map each `BalanceRow.accountId` → `minor`.
3. `securityIds`: unique `positions[].securityId` union any security ids on posted journals if easily available; minimum is unique from `snapshot.positions`.
4. `externalAccountId`: open account with `type === "EXTERNAL"`; if missing, leave `null` (form shows empty state: need EXTERNAL + at least one household account — not “two arbitrary accounts”).
5. Empty-state rule becomes: need `externalAccountId` and ≥1 household account (except TRANSFER needs ≥2 household accounts — handle in UI).

- [ ] **Step 1: Extend the return type and implementation of `loadEntryFormData`**

- [ ] **Step 2: Update `entry/page.tsx` to pass the new props through**

- [ ] **Step 3: Temporarily widen `EntryScreenProps` to accept the new fields (even if unused yet) so typecheck passes**

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @stonks/web typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/portfolio.ts apps/web/app/\(app\)/entry/page.tsx apps/web/components/entry-screen.tsx
git commit -m "$(cat <<'EOF'
feat(web): load balances, positions, and securities for entry form
EOF
)"
```

---

### Task 4: Adaptive entry UI — non-trade types

**Files:**
- Modify: `apps/web/components/entry-screen.tsx` (major rewrite)

**Scope this task:** DEPOSIT, WITHDRAWAL, TRANSFER, DIVIDEND, INTEREST_EARNED, INTEREST_CHARGED, FEE. Leave BUY/SELL/OPENING stubs that show “coming in next task” **or** implement simple disabled notes — prefer implementing full fields for these seven now using `buildEntryPostings`.

UX rules:

| Type | Fields |
|------|--------|
| DEPOSIT | Into (householdAccounts), amount, date, memo |
| WITHDRAWAL | From (household), amount, date, memo |
| TRANSFER | From, To (household only), amount, date, memo; label shows cash via `formatMoney` / minor string; facility use when From is CREDIT_FACILITY |
| DIVIDEND | Into, amount, optional security select (`securityIds` + free “other” text only if list empty — prefer Select of known ids + text field “New security id” optional), date, memo |
| INTEREST_EARNED | Into, amount, date, memo |
| INTEREST_CHARGED / FEE | Charged on, amount, date, memo; FEE optional security |

Sufficiency on submit (before fetch):

- WITHDRAWAL / FEE / INTEREST_CHARGED / TRANSFER: if `cashShortfallMinor(cashAvailableMinor(cashByAccountId[payingId]), amountMinor) > 0n`, set error `"Not enough cash in {name}"` and do not POST.

Submit: `buildEntryPostings` → `POST /api/journals` with `{ type, tradeDate, memo?, postings, facilityUses? }`.

Remove the universal From/To pair and stop calling `defaultEntryAccounts` / `balancedMovePostings`.

Empty states:

- No EXTERNAL → explain need for an External account
- TRANSFER with &lt; 2 household accounts → explain

- [ ] **Step 1: Rewrite `EntryForm` field switching for the seven types**

- [ ] **Step 2: Manual smoke** (`pnpm --filter @stonks/web dev`) — deposit and transfer post successfully

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/entry-screen.tsx
git commit -m "$(cat <<'EOF'
feat(web): adaptive entry form for cash, transfer, and income types
EOF
)"
```

---

### Task 5: BUY / SELL UI + guided transfer on short cash

**Files:**
- Modify: `apps/web/components/entry-screen.tsx`

**BUY fields:** brokerage (`householdAccounts`, prefer INVESTMENT then CASH), security (Select of `securityIds` + inline “Add security…” text that sets a new id), quantity, cost (amount), date, memo.

**SELL fields:** same, amount = proceeds; quantity = qty sold (positive).

On BUY submit:

1. Require securityId + quantity + amount &gt; 0
2. `shortfall = cashShortfallMinor(cashAvailableMinor(cashByAccountId[accountId]), amountMinor)`
3. If `shortfall > 0n`: do **not** post buy. Enter `mode: "fund-transfer"` UI state with:
   - `toAccountId` = brokerage (locked)
   - `fromAccountId` = first other household account with `cashAvailableMinor >= shortfall`, else first other
   - `transferAmount` default = shortfall formatted for the amount input
   - Copy: “Not enough cash in {broker}. Transfer in first?”
   - Actions: Post transfer | Cancel (return to buy form, preserve fields)
4. Transfer success → clear fund mode, restore buy fields, optionally refresh via `router.refresh()` so cash balances update; user submits buy again.

On SELL submit:

1. Find position where `accountId` + `securityId` match
2. If `exceedsPositionQty(position?.quantity, quantity)` → error, no POST
3. Else `buildEntryPostings({ type: "SELL", ... })` and POST

Security picker:

- Select from `securityIds`
- “Add security…” reveals a text field; on blur/confirm, use that string as `securityId` for the post (no master-table invent in this plan unless already trivial — journal posts already accept free-text `securityId`)

- [ ] **Step 1: Implement BUY/SELL fields + guided transfer state machine in `EntryForm`**

- [ ] **Step 2: Smoke test short-cash path and a successful sell (qty decreases)**

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/entry-screen.tsx
git commit -m "$(cat <<'EOF'
feat(web): BUY/SELL entry with guided cash transfer and oversell block
EOF
)"
```

---

### Task 6: OPENING modes

**Files:**
- Modify: `apps/web/components/entry-screen.tsx`

**UI:** When type is OPENING, show mode toggle: **Cash** | **Position**.

- Cash: account + amount (+ EXTERNAL implied) — amount &gt; 0 required
- Position: account + security + quantity; cost TextField optional; checkbox or clear cost = “I don’t know cost” → `costMinor: null`

Use `buildEntryPostings` OPENING variants. Unknown-cost path must post `amountMinor: "0"` legs (API already allows zero minors if balanced).

- [ ] **Step 1: Add OPENING mode UI and submit path**

- [ ] **Step 2: Smoke — unknown-cost opening appears as unknown cost on Positions**

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/entry-screen.tsx
git commit -m "$(cat <<'EOF'
feat(web): OPENING cash and position modes on entry form
EOF
)"
```

---

### Task 7: Cleanup + regression check

**Files:**
- Modify: `apps/web/lib/journals.ts` — delete unused `balancedMovePostings` and `defaultEntryAccounts` if no remaining imports
- Grep for leftover From/To entry copy
- Modify tests that imported removed helpers

- [ ] **Step 1: Grep and delete dead helpers**

```bash
rg "balancedMovePostings|defaultEntryAccounts" apps/web
```

- [ ] **Step 2: Run web + ledger tests**

```bash
pnpm --filter @stonks/web test
pnpm --filter @stonks/web typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -A apps/web
git commit -m "$(cat <<'EOF'
refactor(web): remove obsolete From/To entry helpers
EOF
)"
```

---

## Spec coverage (self-check)

| Spec item | Task |
|-----------|------|
| BUY same-account mental model | 1, 5 |
| SELL mirror + qty negate | 1, 5 |
| DEPOSIT/WITHDRAWAL single account | 1, 4 |
| TRANSFER + balances + block short cash | 2, 4 |
| Income/expense single account + optional security | 1, 4 |
| OPENING two modes + unknown cost | 1, 6 |
| BUY guided transfer | 5 |
| SELL oversell block | 2, 5 |
| Security picker + add | 3, 5 |
| CORPORATE_ACTION out of scope | — |
| Facility-funded BUY out of scope | — |
| No global API negative-cash ban | 2, 4 (UI only) |
`}