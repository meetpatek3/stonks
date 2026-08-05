# Facility Terms on Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set credit-facility terms (benchmark + spread, day-count, posting rule, capitalize) and maintain benchmark rate points from the Accounts UI so Borrowing can model LOC interest.

**Architecture:** Extend `@stonks/db` `FacilityTermsRepo` with writes (append terms with effective dating; create benchmarks; upsert rate points). Thin authenticated API routes under `/api/facility-terms` and `/api/benchmarks`. Accounts screen shows a Terms section when creating/editing a `CREDIT_FACILITY`. No MCP write tools in this plan. Entry-form work is a sibling plan.

**Tech Stack:** Drizzle + Postgres, Next.js route handlers, HeroUI, Vitest (+ existing db integration test pattern), `@stonks/ledger` `FacilityTerms` / `DayCount` / `PostingDayRule` types.

**Spec:** [`docs/superpowers/specs/2026-08-05-entry-form-and-facility-terms-design.md`](../specs/2026-08-05-entry-form-and-facility-terms-design.md) Part B.

**Sibling plan:** Entry form redesign — do not implement Part A here.

## Global Constraints

- Rate math stays integer bps + existing interest engine — never invent rates when terms/curve missing.
- Terms are effective-dated; saving a new open row closes the previous open row (`effective_to = day before new effective_from`, or `effective_from` itself if same day is disallowed — pick one rule and test it: **close prior with `effective_to = new.effectiveFrom` when ranges are `[from, to)` OR use inclusive `effective_to = day before`**. Match the existing read query: `effective_from <= asOf AND (effective_to IS NULL OR effective_to >= asOf)`. Use **close prior: set `effective_to` to the day before the new `effective_from`** (ISO date arithmetic in the repo). If that yields `effective_to < prior.effective_from`, reject.
- Benchmark rate points append/replace by primary key `(benchmark_id, effective_date)` — upsert on same date.
- Household scoping: only attach terms to `CREDIT_FACILITY` accounts owned by the session household.
- `benchmark_rate` is global reference data (no `household_id` column today) — list/create by name; do not invent per-household benchmarks tables in this pass.
- No custom CSS; HeroUI only.
- Do not add MCP `set_facility_terms` in this pass.

---

## File structure

```text
packages/db/
  src/repos/facility-terms-repo.ts      # extend with writes + listAllBenchmarks
  src/index.ts                          # export new types
  tests/facility-terms-repo.integration.test.ts  # extend
apps/web/
  lib/facility-terms.ts                 # NEW: request handlers (pure validation)
  app/api/benchmarks/route.ts           # NEW: GET list, POST create
  app/api/benchmarks/[id]/points/route.ts  # NEW: PUT upsert point
  app/api/accounts/[id]/facility-terms/route.ts  # NEW: GET current / POST new terms
  components/accounts-screen.tsx        # Terms UI on CREDIT_FACILITY
  components/facility-terms-fields.tsx  # NEW: shared fields + benchmark rate editor
  tests/facility-terms-api.test.ts      # NEW: handler unit tests
```

---

### Task 1: Repo writes — benchmarks, points, terms

**Files:**
- Modify: `packages/db/src/repos/facility-terms-repo.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/facility-terms-repo.integration.test.ts`

**Interfaces:**
- Extend `FacilityTermsRepo`:

```ts
export type CreateBenchmarkInput = { name: string };

export type UpsertBenchmarkPointInput = {
  effectiveDate: string; // YYYY-MM-DD
  rateBps: number; // integer
};

export type CreateFacilityTermsInput = {
  accountId: string;
  benchmarkId: string;
  spreadBps: number;
  dayCount: DayCount;
  postingDayRule: PostingDayRule;
  capitalizeInterest: boolean;
  effectiveFrom: string; // YYYY-MM-DD
};

export interface FacilityTermsRepo {
  // existing:
  listEffectiveTerms(householdId: string, asOf: string): Promise<FacilityTermsRecord[]>;
  listBenchmarkCurves(benchmarkIds: readonly string[]): Promise<Map<string, BenchmarkCurve>>;

  // new:
  listBenchmarks(): Promise<Array<{ id: string; name: string }>>;
  createBenchmark(input: CreateBenchmarkInput): Promise<{ id: string; name: string }>;
  upsertBenchmarkPoint(
    benchmarkId: string,
    input: UpsertBenchmarkPointInput,
  ): Promise<void>;
  /**
   * Insert terms for a CREDIT_FACILITY in `householdId`.
   * Closes any open prior row for that account (effective_to = day before
   * effectiveFrom). Rejects if account missing, wrong household, or not
   * CREDIT_FACILITY. Rejects unknown benchmarkId.
   */
  insertTerms(
    householdId: string,
    input: CreateFacilityTermsInput,
  ): Promise<FacilityTermsRecord>;
  /** Latest terms row for account (any effective window), or null. */
  getLatestTerms(
    householdId: string,
    accountId: string,
  ): Promise<(FacilityTermsRecord & { id: string }) | null>;
}
```

Date helper in the repo file (pure):

```ts
/** YYYY-MM-DD → previous calendar day, UTC date parts only. */
export function isoDateMinusOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
```

- [ ] **Step 1: Write failing integration tests** (follow patterns in existing `facility-terms-repo.integration.test.ts` — `describeIfDb`)

Cover:

1. `createBenchmark` + `upsertBenchmarkPoint` + `listBenchmarkCurves` returns the point
2. `insertTerms` for a CREDIT_FACILITY returns record; `listEffectiveTerms` asOf ≥ effectiveFrom finds it
3. Second `insertTerms` with later `effectiveFrom` closes the first (`effectiveTo` set); asOf in first window returns first spread; asOf in second returns second
4. `insertTerms` on a CASH account fails / returns rejection (throw `ValidationError` with a clear code, or return null — prefer throw `ValidationError` with message containing `CREDIT_FACILITY`)
5. Cross-household account id cannot receive terms

- [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter @stonks/db test tests/facility-terms-repo.integration.test.ts
```

Expected: FAIL on missing methods (skip/pass empty suite if DB unavailable — same as existing).

- [ ] **Step 3: Implement write methods on `createFacilityTermsRepo`**

`insertTerms` outline:

```ts
async insertTerms(householdId, input) {
  const [acct] = await db
    .select()
    .from(account)
    .where(and(eq(account.id, input.accountId), eq(account.householdId, householdId)));
  if (!acct || acct.type !== "CREDIT_FACILITY") {
    throw new ValidationError("Account must be a CREDIT_FACILITY in this household", "ACCOUNT");
  }
  // verify benchmark exists
  const priorOpen = /* select where accountId and effectiveTo is null */;
  if (priorOpen) {
    const closedTo = isoDateMinusOneDay(input.effectiveFrom);
    if (closedTo < priorOpen.effectiveFrom) {
      throw new ValidationError("effectiveFrom overlaps prior terms", "TERMS");
    }
    await db.update(creditFacilityTerms).set({ effectiveTo: closedTo }).where(eq(creditFacilityTerms.id, priorOpen.id));
  }
  const [row] = await db.insert(creditFacilityTerms).values({...input, effectiveTo: null}).returning();
  return toRecord(row);
}
```

Import `ValidationError` from `@stonks/ledger` like `account-repo.ts`.

- [ ] **Step 4: Export new types from `packages/db/src/index.ts`**

- [ ] **Step 5: Run — PASS** (with local Docker Postgres if required)

```bash
docker compose up -d postgres
pnpm --filter @stonks/db test tests/facility-terms-repo.integration.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/facility-terms-repo.ts packages/db/src/index.ts packages/db/tests/facility-terms-repo.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): write facility terms, benchmarks, and rate points

Effective-date new terms rows and close prior open windows for credit facilities.
EOF
)"
```

---

### Task 2: API handlers (pure) + routes

**Files:**
- Create: `apps/web/lib/facility-terms.ts`
- Create: `apps/web/tests/facility-terms-api.test.ts`
- Create: `apps/web/app/api/benchmarks/route.ts`
- Create: `apps/web/app/api/benchmarks/[id]/points/route.ts`
- Create: `apps/web/app/api/accounts/[id]/facility-terms/route.ts`

**Interfaces:**
- Produces handlers taking injected repo + session household (mirror `apps/web/lib/accounts.ts` style):

```ts
export type FacilityTermsSession = { householdId: string };

export function parseSpreadToBps(raw: unknown): number | null;
// Accepts integer bps number, or string "0.50" meaning 0.50% → 50 bps.
// Prefer: body field `spreadBps` as integer; optional UI sends percent and converts client-side.
// API: require integer `spreadBps` only (simplest).

export async function listBenchmarksHandler(ctx: { repo: FacilityTermsRepo }): Promise<...>;
export async function createBenchmarkHandler(body: unknown, ctx: {...}): Promise<...>;
export async function upsertBenchmarkPointHandler(
  benchmarkId: string,
  body: unknown,
  ctx: {...},
): Promise<...>;
export async function getFacilityTermsHandler(
  accountId: string,
  ctx: { session: FacilityTermsSession; repo: FacilityTermsRepo },
): Promise<...>;
export async function createFacilityTermsHandler(
  accountId: string,
  body: unknown,
  ctx: {...},
): Promise<...>;
```

Body for create terms:

```json
{
  "benchmarkId": "uuid",
  "spreadBps": 50,
  "dayCount": "ACT_365",
  "postingDayRule": "MONTH_END",
  "capitalizeInterest": true,
  "effectiveFrom": "2024-01-01"
}
```

Body for rate point:

```json
{ "effectiveDate": "2024-06-01", "rateBps": 525 }
```

Auth: session required; 401 if missing. 503 if no DB. Map `ValidationError` → 400.

- [ ] **Step 1: Write failing unit tests** for parsers/handlers with a fake in-memory repo stub

```ts
it("rejects non-integer spreadBps", async () => {
  const result = await createFacilityTermsHandler("fac-1", {
    benchmarkId: "b1",
    spreadBps: 50.5,
    dayCount: "ACT_365",
    postingDayRule: "MONTH_END",
    capitalizeInterest: true,
    effectiveFrom: "2024-01-01",
  }, ctx);
  expect(result.ok).toBe(false);
  expect(result.status).toBe(400);
});
```

- [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter @stonks/web test tests/facility-terms-api.test.ts
```

- [ ] **Step 3: Implement `lib/facility-terms.ts` + thin route files**

Routes:

- `GET /api/benchmarks` → `{ benchmarks: [{ id, name }] }`
- `POST /api/benchmarks` → `{ id, name }`
- `PUT /api/benchmarks/[id]/points` → `{ ok: true }`
- `GET /api/accounts/[id]/facility-terms` → latest terms + curve points for its benchmark (or `{ terms: null }`)
- `POST /api/accounts/[id]/facility-terms` → created terms record

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/facility-terms.ts apps/web/tests/facility-terms-api.test.ts \
  apps/web/app/api/benchmarks apps/web/app/api/accounts
git commit -m "$(cat <<'EOF'
feat(web): API for facility terms and benchmark rate points
EOF
)"
```

---

### Task 3: Accounts UI — terms on CREDIT_FACILITY

**Files:**
- Create: `apps/web/components/facility-terms-fields.tsx`
- Modify: `apps/web/components/accounts-screen.tsx`

**UX:**

1. **Add account dialog:** leave create as today (name/type/currency only). Each `CREDIT_FACILITY` card gets a **Terms** button that opens the terms modal (create or replace effective-dated terms).

2. **Terms modal** (`FacilityTermsModal`):
   - Load `GET /api/accounts/[id]/facility-terms` + `GET /api/benchmarks`
   - Fields: benchmark Select + “Create benchmark…” (name → POST /api/benchmarks), spread (UI: percent input `"0.50"` → `spreadBps = Math.round(percent * 100)` only after validating plain decimal — **or** integer bps input labeled “Spread (bps)” — prefer **bps integer** to avoid float; Label: `Spread (basis points)`), day count Select, posting-day rule Select, capitalize Switch, effective from date
   - Benchmark rate points list + add row (date + rate bps) → PUT points
   - Submit → POST facility-terms → `router.refresh()`

3. Show a Chip on the card when terms missing: “No terms” (Borrowing already explains missing terms; this helps discoverability).

- [ ] **Step 1: Build `FacilityTermsFields` + modal; wire Terms button on CREDIT_FACILITY cards**

Need current terms presence: either extend accounts page loader to include `facilityAccountIdsWithTerms: string[]` via `listEffectiveTerms(householdId, today)`, or fetch on modal open only. Prefer extend `accounts/page.tsx` load to pass `termsStatusByAccountId: Record<string, boolean>` from `listEffectiveTerms` for chip display.

- [ ] **Step 2: Smoke** — create LOC, set Prime benchmark + rate point + spread 50, open Borrowing and confirm effective rate appears (not “needs facility terms”)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/facility-terms-fields.tsx apps/web/components/accounts-screen.tsx \
  apps/web/app/\(app\)/accounts/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): manage credit facility terms and benchmarks from Accounts
EOF
)"
```

---

### Task 4: Loader wiring for terms chips + final verification

**Files:**
- Modify: `apps/web/app/(app)/accounts/page.tsx` (if not done in Task 3)
- Modify: accounts load helper if one exists beside the page

- [ ] **Step 1: Ensure page passes which facilities have effective terms as-of today**

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @stonks/db test tests/facility-terms-repo.integration.test.ts
pnpm --filter @stonks/web test tests/facility-terms-api.test.ts
pnpm --filter @stonks/web typecheck
```

Expected: PASS

- [ ] **Step 3: Commit** if any remaining loader fixes

```bash
git add apps/web/app/\(app\)/accounts/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): show facility terms status on account cards
EOF
)"
```

---

## Spec coverage (self-check)

| Spec item | Task |
|-----------|------|
| Terms on Accounts for CREDIT_FACILITY | 3 |
| benchmark + spread + day count + posting rule + capitalize + effective from | 1–3 |
| Inline create benchmark + rate points | 1–3 |
| Effective dating / close prior | 1 |
| Write API for UI | 2 |
| MCP writes out of scope | — |
| Separate Benchmarks admin out of scope | — |
| Borrowing reads unchanged | 3 smoke |
`}