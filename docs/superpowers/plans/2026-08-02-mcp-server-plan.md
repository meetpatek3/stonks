# Plan — Stonks MCP Server

Implements `docs/superpowers/specs/2026-08-02-mcp-server-design.md`: a Streamable HTTP MCP
server at `apps/web/app/api/mcp/[transport]/route.ts` (via `mcp-handler` over the official
`@modelcontextprotocol/sdk`), authenticated with household-scoped bearer tokens, exposing the
app's full user-facing capability surface as tools, resources, and prompts.

Repo: `/Users/meetpatel/Developer/stonks/.claude/worktrees/portfolio-tracker-ui-rebuild-436269`
Read the spec before starting any task.

---

## Global Constraints

These bind **every** task. Reviewers check against them verbatim.

**Money and quantity typing (the rule most likely to be violated by habit)**
- Money is `bigint` minor units. Quantities are fixed-scale decimal strings. JS `number`
  must never touch a money or quantity path — not in `packages/ledger`, `packages/db`,
  the MCP layer, or any read-model computation.
- JSON numbers are IEEE-754 doubles. Therefore **every monetary and quantity field in every
  MCP tool input schema and output payload is a string**, validated: amounts as integer
  minor-unit strings (`z.string().regex(/^-?\d+$/)`), quantities as fixed-scale decimal
  strings, FX rates as rational `{ fxRateN, fxRateD }` bigint strings. A tool schema that
  types an amount, quantity, or FX rate as `z.number()` is a **correctness bug**, not a style
  preference. All such schemas come from the shared module `apps/web/lib/mcp/schemas.ts` —
  no tool defines its own money schema.
- Integer basis points (`rateBps`, allocation `bps`) are the only rate-like fields permitted
  as JSON numbers.

**Ledger authority**
- The ledger is the authoritative source of truth. Balances, positions, cost basis and gains
  are derived by replay. MCP tools must never accept or store a computed balance.
- Tools call the existing read model (`apps/web/lib/portfolio.ts` /
  `portfolio-derive.ts`) and repositories (`@stonks/db`), never reimplement ledger maths.
  `portfolio-derive.ts` / `portfolio-shared.ts` are under active extension by another
  workstream: depend on their exported shape, not exact contents; if a needed export is
  missing, add it in your task with tests rather than duplicating logic.

**Immutability and corrections**
- Journals are immutable; corrections use supersession (`SUPERSEDED` +
  `supersedesJournalId`). No tool edits or deletes history. Replay order is `trade_date`
  then `sort_key`; `sort_key` is assigned server-side, never client-supplied.

**Uncertainty and traceability**
- Every calculated value must be traceable, and uncertain data must stay visibly uncertain.
  Tool responses carry uncertainty flags (unknown cost basis → `costIsUnknown` with
  dependent fields `null` + reason, modelled vs actual interest → `basis` tag, stale price →
  `stale`, missing FX → explicit flag). Never emit a clean-looking number for an estimate,
  never substitute `0` for unknown. Carry `sourceJournalIds` where the read model provides them.

**Tenancy and auth**
- Every MCP request authenticates via a bearer token resolving to exactly one
  `{ householdId, scope }`. Every repository call takes that householdId; every id lookup is
  `WHERE household_id = ? AND id = ?`. Cross-household access is a security defect.
- Scope (`read` | `read_write`) is enforced by the shared tool registrar before the handler
  runs, driven by each tool's declaration — never by per-handler discipline.
- No MCP tool creates, lists, or revokes tokens, or touches auth credentials.

**Write safety**
- Read tools declare `readOnlyHint: true`. `supersede_journal`, `commit_import_batch`, and
  `close_account` declare `destructiveHint: true` and require `confirm: true`, returning a
  preview (no mutation) when it is absent.

**Error semantics**
- Domain `ValidationError`s map to structured tool errors with the spec §10 `code` values and
  actionable messages. Never a swallowed failure or generic 500 for a domain error. Schema
  failures name the field and the expected string format.

**Platform**
- Next.js 15 App Router, pnpm workspaces, self-hostable (no Vercel-only APIs; stateless MCP
  mode, no Redis). `apps/web/middleware.ts` must exempt `/api/mcp` from cookie auth.

**Testing (TDD — non-negotiable)**
- Write the failing test first. Run it. Confirm it fails **for the intended reason**. Then
  implement. Then confirm it passes.
- Web tests live in `apps/web/tests/*.test.ts`, run with `pnpm --filter @stonks/web test`;
  db-package tests alongside existing `packages/db` conventions. Expected values in tests are
  independently hand-calculated, never snapshots of current output.
- MCP tool handlers are tested by extracting them as pure functions
  (`apps/web/lib/mcp/tools/*.ts`) taking `(ctx, input)` where `ctx` carries householdId,
  scope, and injected repos — tests inject in-memory fakes; no HTTP server or database needed
  for unit tests.
- After every task: `pnpm --filter @stonks/web build` and
  `pnpm --filter @stonks/web typecheck` pass, plus `pnpm test` for touched packages.
- **Do not modify files owned by the in-flight UI rebuild** (pages, components, globals.css)
  except the single middleware exemption in Task 3.

---

## Task 1: API token schema and verification

**Goal:** the credential model — `api_token` table, hashing, and a repo that turns a bearer
token into `{ householdId, scope }`.

**Files:** `packages/db/src/schema/api_token.ts` (new), `packages/db/src/schema/index.ts`,
new Drizzle migration, `packages/db/src/repos/token-repo.ts` (new),
`packages/db/src/index.ts`, `packages/db/tests/token-repo.test.ts` (new — follow the existing
test layout in `packages/db`; if repo tests there require a database, structure the repo so
hashing/parsing logic is pure and unit-tested, with DB round-trip covered in Task 12).

**Steps**

1. Write failing tests first: token generation returns `stk_`-prefixed 43+ char string;
   `hashToken` is deterministic SHA-256 hex; `verifyToken` on a valid unrevoked row returns
   `{ householdId, scope }`; revoked (`revoked_at` set) and unknown tokens return `null`;
   verification never returns another household's id.
2. Add `api_token` table exactly per spec §3: `id, household_id FK NOT NULL, name,
   token_hash UNIQUE, scope CHECK IN ('read','read_write'), created_at, last_used_at,
   revoked_at`. Generate the migration (`pnpm migrate` tooling); **do not run it against any
   shared database — generating the SQL file is enough for this task.**
3. Implement `createTokenRepo(db)`: `create(householdId, name, scope)` → returns plaintext
   once + row id; `verify(plaintext)` → hash lookup, null on revoked/missing, stamps
   `last_used_at`; `revoke(householdId, id)`; `list(householdId)` (no hashes in output).
4. Export from `packages/db/src/index.ts`. Verify: tests pass, `pnpm --filter @stonks/db
   build` (or typecheck) passes.

---

## Task 2: Token management API (web, cookie-authenticated)

**Goal:** the human can mint and revoke agent tokens. Web API only — deliberately not MCP.

**Files:** `apps/web/app/api/tokens/route.ts` (new: GET list, POST create),
`apps/web/app/api/tokens/[id]/route.ts` (new: DELETE revoke),
`apps/web/tests/tokens-api.test.ts` (new).

**Steps**

1. Failing tests first (mock `getSession` and inject a fake token repo): unauthenticated →
   401; POST with `{ name, scope }` returns plaintext token exactly once and never in GET;
   GET lists id/name/scope/created/lastUsed/revoked but no hash or plaintext; DELETE revokes
   only within the session's household (a foreign id → 404, not another household's revocation).
2. Implement using `getSession()` from `apps/web/lib/auth/session.ts` for auth and
   `createTokenRepo` from Task 1. Validate `scope` against the two allowed values.
3. Verify: tests, build, typecheck. (A settings UI is out of scope — the API is sufficient
   for v1 and avoids touching UI-rebuild files.)

---

## Task 3: MCP server scaffold — transport, auth, registrar, shared schemas

**Goal:** a running MCP endpoint with bearer auth, central scope enforcement, shared
money/quantity Zod schemas, error mapping, and one trivial `ping` tool proving the pipeline.

**Files:** `apps/web/app/api/mcp/[transport]/route.ts` (new),
`apps/web/lib/mcp/auth.ts` (new), `apps/web/lib/mcp/registrar.ts` (new),
`apps/web/lib/mcp/schemas.ts` (new), `apps/web/lib/mcp/errors.ts` (new),
`apps/web/middleware.ts` (add `/api/mcp` to the public matcher — the only shared file this
plan touches), `apps/web/package.json` (add `mcp-handler`, `@modelcontextprotocol/sdk`, `zod`),
`apps/web/tests/mcp-scaffold.test.ts` (new).

**Steps**

1. Failing tests first, against the pure pieces:
   - `schemas.ts`: `zMinorAmount` accepts `"0"`, `"-1500000"`, rejects `"1.5"`, `"1e3"`, `""`,
     and any JSON number; `zQuantity` accepts `"420.00000000"`, `"0.5"`, rejects floats-as-numbers
     and >8 dp; `zFxRational` requires bigint-string n/d; `zTradeDate` enforces `YYYY-MM-DD`.
   - `auth.ts`: `authenticate(headers, tokenRepo)` → context for valid token; `null` for
     absent/malformed/revoked.
   - `registrar.ts`: registering a tool with `scope: "read_write"` and calling it with a
     `read` context returns a `SCOPE_DENIED` tool error without invoking the handler;
     `readOnlyHint`/`destructiveHint` annotations pass through; a handler throwing
     `ValidationError` yields `isError: true` with a `code` and the ledger's message
     (via `errors.ts` mapping per spec §10); an unexpected `Error` yields a generic message
     with no stack text.
2. Implement. The route handler wires `mcp-handler` (stateless), reads
   `Authorization: Bearer`, 401s before MCP processing when invalid, and passes
   `{ householdId, scope, repos }` context to registered tools. `registrar.ts` exposes
   `defineTool({ name, scope, annotations, inputSchema, handler })` used by all later tasks.
3. Register `ping` (read scope) returning server name + household reporting currency (via a
   repo call, proving DB scoping works end to end).
4. Add the middleware exemption. Verify: tests, build, typecheck; manually confirm
   `curl -X POST /api/mcp/mcp` without a token → 401 in `pnpm --filter @stonks/web dev` if a local
   DB is available (optional smoke, not the test gate).

---

## Task 4: Journal repository extensions (prerequisites for reads and corrections)

**Goal:** the repo functions later tasks need: filtered history incl. superseded, single
fetch, supersession, natural-key lookup, next sort_key.

**Files:** `packages/db/src/repos/journal-repo.ts`, `packages/db/src/index.ts`,
tests per `packages/db` conventions (pure mapping logic unit-tested; DB round-trips in Task 12).

**Steps**

1. Failing tests first for the new interface behaviour (with an in-memory/fake db layer if
   the package tests run DB-less; otherwise integration-style per existing convention):
   - `listAll(householdId, { type?, accountId?, from?, to?, includeSuperseded?, limit?, cursor? })`
     returns superseded journals only when asked, ordered by `(trade_date, sort_key, id)`.
   - `getById(householdId, id)` → journal or null; **null for another household's id**.
   - `findByNaturalKey(householdId, key)` → id or null.
   - `nextSortKey(householdId, tradeDate)` → max+1 (or initial value matching existing
     insert conventions).
   - `supersedePosted(householdId, oldId, replacement)`: one transaction — old row must be
     `POSTED` (else `ValidationError`), set `status = 'SUPERSEDED'`, insert replacement with
     `supersedesJournalId = oldId` via the existing insert path. Partial failure rolls back.
2. Implement, reusing `toDomainJournal`. Keep `insertPosted`/`listPosted` behaviour unchanged
   (other code depends on them).
3. Verify: package tests, typecheck/build.

---

## Task 5: Read tools — portfolio, accounts, positions, open items

**Goal:** tools 1, 2, 3, 9 of the spec catalogue, delegating to the snapshot read model.

**Files:** `apps/web/lib/mcp/tools/portfolio.ts` (new), registration in the route file,
`apps/web/tests/mcp-portfolio-tools.test.ts` (new).

**Steps**

1. Failing tests first, injecting a fake snapshot provider returning a hand-built
   `PortfolioSnapshot` (in-memory journals → `derivePortfolioSnapshot` where practical):
   - `get_portfolio_overview` output: every money field is a string of minors matching the
     snapshot exactly; allocation bps sum to 10000; `allocationBasis` present.
   - `list_positions`: a position with unknown cost has `costIsUnknown: true`,
     `costReportingMinor: null`, and no derived-gain number; **assert
     `typeof` every money/qty field is `"string"` across the whole payload** (a recursive
     assertion helper — write it once here, reuse in later tool tests).
   - `list_accounts` includes replay balances and respects `includeClosed`.
   - `list_open_items` carries `kind`, `severity`, `message`, and trace ids; severity filter works.
2. Implement as `defineTool` handlers calling `getPortfolioSnapshot` (inject it via ctx for
   testability), all `readOnlyHint: true`, scope `read`. If the snapshot type is still gaining
   fields from the UI workstream, consume only the fields listed here.
3. Verify: tests, build, typecheck.

---

## Task 6: Read tools — journal history

**Goal:** `list_journals` and `get_journal` (spec tools 4–5).

**Files:** `apps/web/lib/mcp/tools/journals-read.ts` (new), registration,
`apps/web/tests/mcp-journal-read-tools.test.ts` (new).

**Steps**

1. Failing tests first, injecting a fake journal repo built on Task 4's interface:
   - filters (type, account, date range) pass through; superseded excluded by default,
     included and explicitly `status: "SUPERSEDED"`-marked when requested;
   - `get_journal` returns postings with minor-string amounts, quantities as decimal strings,
     facility uses, and the supersession chain (supersedes / superseded-by);
   - `get_journal` for a foreign/unknown id → `UNKNOWN_JOURNAL` tool error, not a 500;
   - pagination: `limit` honoured, `cursor` round-trips.
2. Implement (scope `read`, `readOnlyHint: true`), delegating to `listAll`/`getById`.
   Superseded-by is derived via a repo query on `supersedesJournalId`.
3. Verify: tests, build, typecheck.

---

## Task 7: Write tools — record_journal and supersede_journal

**Goal:** the core mutation path (spec tools 13–14), through the domain validators only.

**Files:** `apps/web/lib/mcp/tools/journals-write.ts` (new), registration,
`apps/web/tests/mcp-journal-write-tools.test.ts` (new).

**Steps**

1. Failing tests first (fake repo capturing inserts):
   - balanced BUY journal (two postings, minor strings) → inserted; returned id; postings
     reached the repo as `bigint`/`Quantity`, converted via `BigInt`/`qtyFromDecimalString`
     only;
   - unbalanced journal → `UNBALANCED_JOURNAL` tool error carrying the ledger's message;
     nothing inserted;
   - facility draw without 100% facility-use lines → `FACILITY_USE_INCOMPLETE`;
   - input with `amountMinor` as a JSON number → schema error naming the field and the
     string format (this is the habit-violation test — it must exist and fail red first);
   - `externalNaturalKey` already present → `{ duplicate: true, journalId }`, no second insert;
   - OPENING with quantity and no cost → accepted, cost stays absent (no zero substituted);
   - `sort_key` is server-assigned via `nextSortKey`; client-supplied sortKey is rejected by
     the schema;
   - `supersede_journal` without `confirm` → preview (old + replacement echo), no mutation;
     with `confirm: true` → `supersedePosted` called once; superseding an already-superseded
     journal → `ValidationError` mapped error;
   - every referenced accountId is checked against the household's accounts;
     a foreign account → `UNKNOWN_ACCOUNT`.
2. Implement: input schema from `schemas.ts` (journal type enum, postings array min 2,
   facilityUses). Build the domain `Journal`, run `assertJournalBalanced` +
   `assertFacilityUseComplete`, persist via `insertPosted` / `supersedePosted`. Scope
   `read_write`; `record_journal` `destructiveHint: false`; `supersede_journal`
   `destructiveHint: true`.
3. Verify: tests, build, typecheck.

---

## Task 8: Account repository + account management tools

**Goal:** `create_account`, `close_account`, `list_accounts` backing (spec tools 15–16),
with the missing account repo as the named prerequisite.

**Files:** `packages/db/src/repos/account-repo.ts` (new), `packages/db/src/index.ts`,
`apps/web/lib/mcp/tools/accounts.ts` (new), registration,
`apps/web/tests/mcp-account-tools.test.ts` (new), db-package tests per convention.

**Steps**

1. Failing repo tests first: `create(householdId, { name, type, currency, taxTreatment })`;
   `list(householdId, { includeClosed })`; `close(householdId, id)` sets `closed_at`;
   `getById` household-scoped (foreign id → null). Then implement against
   `packages/db/src/schema/account.ts`.
2. Failing tool tests: `create_account` validates type against the five `AccountType`
   values and currency against known currencies; `close_account` without `confirm` →
   preview; with `confirm` but nonzero replay balance → `ACCOUNT_NOT_EMPTY` error naming the
   balance (minor string); with zero balance → closed. Balance check uses the snapshot/read
   model, never a stored figure.
3. Implement tools (scope `read_write`; `close_account` `destructiveHint: true`).
4. Verify: all tests, build, typecheck.

---

## Task 9: Borrowing, interest, and tax read tools

**Goal:** `get_borrowing_summary`, `get_interest_attribution`, `get_tax_year_summary`
(spec tools 6–8), plus the facility-terms read repo prerequisite.

**Files:** `packages/db/src/repos/facility-repo.ts` (new: read `credit_facility_terms`,
`benchmark_rate`, `benchmark_rate_point` by household via account join),
`packages/db/src/index.ts`, `apps/web/lib/mcp/tools/borrowing.ts` (new),
`apps/web/lib/mcp/tools/tax.ts` (new), registration,
`apps/web/tests/mcp-borrowing-tools.test.ts`, `apps/web/tests/mcp-tax-tools.test.ts` (new).

**Steps**

1. Failing repo tests, then implement `facility-repo` (reads only; terms rows → domain
   `FacilityTerms`, rate points → `BenchmarkRatePoint[]`).
2. Failing tool tests with hand-calculated fixtures (small journal set + one facility, rates
   chosen for exact arithmetic):
   - use-slice breakdown sums exactly to the facility balance (`sumSlices` invariant);
   - modelled interest fields carry `"basis": "MODELLED"`, actual `"ACTUAL"`; variance equals
     hand-computed difference; when no actual posting exists the response says estimated, not 0;
   - `get_interest_attribution` allocations sum exactly to the investment-slice interest;
   - `get_tax_year_summary` returns `TaxYearSummary` money as minor strings, `TaxFlag[]`
     verbatim, and the literal disclaimer "This is not tax advice." in text content;
   - unknown-cost positions produce flagged/absent gains, never zeros.
3. Implement, delegating to `replayFacilitySlices`, `facilitySlicesAsOf`, `sumSlices`,
   `modelInterest`, `interestVariance`, `attributeInvestmentInterest`,
   `summarizeCanadaTaxYear` — no arithmetic in the tool layer beyond assembling inputs.
   Scope `read`, `readOnlyHint: true`.
4. Verify: tests, build, typecheck.

---

## Task 10: Prices — schema check, repo, and tools

**Goal:** `get_price` and `set_price_override` (spec tools 10, 19), creating the price
tables if the schema lacks them.

**Files:** check `packages/db/src/schema/` for `price_quote` / `price_override`; if absent,
add `packages/db/src/schema/price.ts` + migration per design spec §5.6 (price columns as
minor-unit bigint + currency, never float). `packages/db/src/repos/price-repo.ts` (new),
`packages/db/src/index.ts`, `apps/web/lib/mcp/tools/prices.ts` (new), registration,
`apps/web/tests/mcp-price-tools.test.ts` (new).

**Steps**

1. Inspect schema dir; add missing tables + generated migration first (no float columns;
   note: `security`/`security_symbol` tables may also be absent — if so, key prices by the
   ledger's `securityId` string without an FK and record that in the task report rather than
   inventing a security master here).
2. Failing repo tests: latest quote at/before a date; override lookup; insert override.
3. Failing tool tests: `get_price` resolves override-over-quote via the ledger's
   `resolvePrice`, output carries `source`, `asOf`, minor-string price, and `stale: true`
   when `asOf` < requested date; no price → `PRICE_NOT_FOUND` tool error, never null-as-zero.
   `set_price_override` requires minor-string price + note; appends (never updates in place).
4. Implement (scope: `read` / `read_write` respectively). Verify: tests, build, typecheck.

---

## Task 11: Import and reconciliation tools

**Goal:** spec tools 11–12 and 20–23: statements, batches, preview/commit/reject, reconcile.

**Files:** `packages/db/src/repos/import-repo.ts` (new: `statement`, `import_batch`,
`import_candidate`, `reconciliation_result` tables), `packages/db/src/index.ts`,
`apps/web/lib/mcp/tools/import.ts` (new), registration,
`apps/web/tests/mcp-import-tools.test.ts` (new), db tests per convention.

**Steps**

1. Failing repo tests, then implement household-scoped CRUD-lite over the four tables
   (statuses `PREVIEW`/`COMMITTED`/`REJECTED`, match states `NEW`/`DUPLICATE`/`CONFLICT`).
2. Failing tool tests:
   - `record_statement` stores stated balance as minor string; never touches journals;
   - `create_import_batch` runs `matchImportCandidates` against existing journals
     (via natural keys) and returns per-candidate match states; batch is `PREVIEW`;
   - `commit_import_batch` without `confirm` → preview listing what would post; with
     `confirm` → posts only selected non-`DUPLICATE` candidates, **each through the same
     validation + `insertPosted` path as `record_journal`** (reuse Task 7's builder), marks
     batch `COMMITTED`; an unbalanced candidate aborts with a structured error naming it and
     posts nothing (transactional);
   - `reject_import_batch` marks `REJECTED`, posts nothing;
   - `get_reconciliation` compares replayed balance vs stated via `reconcileStatement`,
     returns `MATCH`/`MISMATCH`, and **never adjusts the books** (assert no repo write occurs).
3. Implement (`commit_import_batch` `destructiveHint: true`; other writes additive; reads
   `readOnlyHint: true`). Verify: tests, build, typecheck.

---

## Task 12: Facility terms + benchmark writes, resources, prompts

**Goal:** spec tools 17–18, the four resources, and the three prompts.

**Files:** `packages/db/src/repos/facility-repo.ts` (extend with effective-dated writes),
`apps/web/lib/mcp/tools/facility-admin.ts` (new), `apps/web/lib/mcp/resources.ts` (new),
`apps/web/lib/mcp/prompts.ts` (new), registration,
`apps/web/tests/mcp-facility-admin.test.ts`, `apps/web/tests/mcp-resources.test.ts` (new).

**Steps**

1. Failing tests: `set_facility_terms` appends an effective-dated row (existing rows
   untouched — assert no update), validates `dayCount` against `ACT/365|ACT/360|ACT/ACT` and
   `spreadBps` as integer; `add_benchmark_rate_point` appends `(effectiveDate, rateBps)`;
   both scope `read_write`, additive annotations.
2. Failing resource tests: `stonks://portfolio/snapshot`, `stonks://accounts`,
   `stonks://open-items` return the same payloads as their tool twins (call the same
   providers — assert deep-equality against the tool output); `stonks://reference/journal-types`
   is static JSON/markdown documenting journal types, the signed debit-positive convention,
   posting shape, minor-unit string rule, and at least one worked example lifted from
   `fixtures/ledger`.
3. Implement resources and the three prompts (`record-transaction`, `monthly-review`,
   `correct-a-mistake`) per spec §9 — prompts are static templates with arguments; test that
   they render and mention the minor-unit string rule and the balance invariant.
4. Verify: tests, build, typecheck.

---

## Task 13: Security and integration test suite

**Goal:** prove the two invariants that matter most — tenant isolation and scope
enforcement — end to end, plus a live-server smoke test.

**Files:** `apps/web/tests/mcp-security.test.ts` (new),
`apps/web/tests/mcp-integration.test.ts` (new; skipped automatically when `DATABASE_URL`
is absent, matching whatever convention `packages/db` integration tests use).

**Steps**

1. Failing security tests first, over the registrar + real tool handlers with a fake
   two-household repo layer:
   - token for household A: every read tool returns only A's data; `get_journal`,
     `close_account`, `supersede_journal` with B's ids → `UNKNOWN_*` errors, never B's data
     and never a mutation of B's rows (assert the fake's write log);
   - `read`-scoped token: **every** registered `read_write` tool returns `SCOPE_DENIED`
     without handler invocation — iterate the registrar's tool list so a newly added tool
     can't dodge the test;
   - revoked token → 401 at the transport layer; missing/garbled Authorization → 401;
   - every registered tool's annotations are present and consistent with its scope
     (read scope ⇒ `readOnlyHint: true`).
2. Integration test (real Postgres when available): migrate, seed two households, create
   tokens via Task 1 repo, drive the actual route handler with `fetch`-style requests through
   the MCP initialize → tools/list → tools/call flow; record a journal, read it back, supersede
   it, confirm replay reflects the correction and history is retained.
3. Fix anything found. Verify: full `pnpm test`, build, typecheck across `@stonks/db` and
   `@stonks/web`.

---

## Task 14: Documentation

**Goal:** an agent-owner can connect without reading source.

**Files:** `docs/mcp.md` (new), `AGENTS.md` (append a short MCP section: endpoint, token
model, the string-money rule, pointer to the spec — do not restructure the file).

**Steps**

1. Write `docs/mcp.md`: endpoint URL (Vercel + self-hosted), creating a token via
   `POST /api/tokens`, example client config (Claude Code `claude mcp add --transport http`
   with `Authorization: Bearer`), the full tool/resource/prompt table from the spec, the
   minor-unit string convention with one worked `record_journal` example, error code table,
   and the security notes (scopes, revocation, confirm-gated tools).
2. Cross-check the tool table against the registrar's actual registrations (list them from
   the code, not from memory); fix drift in whichever is wrong.
3. Verify: `pnpm --filter @stonks/web build` still passes (docs-only, but keep the gate).

---

## Done when

- All 23 tools, 4 resources, and 3 prompts from the spec are registered, annotated, and
  scope-gated; `tools/list` output matches `docs/mcp.md`.
- No tool schema anywhere types money, quantity, or FX as a JSON number
  (`grep -rn "z.number()" apps/web/lib/mcp/tools apps/web/lib/mcp/schemas.ts` shows hits only
  for bps/limit/year-style integers).
- Security suite (Task 13) passes: cross-household isolation and scope enforcement proven.
- `pnpm test`, `pnpm --filter @stonks/web build`, and typecheck all pass.
