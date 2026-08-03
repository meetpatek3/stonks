# Stonks MCP Server — Design Spec

**Date:** 2026-08-02
**Status:** Draft for review
**Companion plan:** `docs/superpowers/plans/2026-08-02-mcp-server-plan.md`

**Product goal (owner's words):** "a user's personal AI agent can connect to the app and do
stuff for the user … the MCP allows agents to do anything in the app that a user can."

---

## 1. Goals and non-goals

### Goals

- A Model Context Protocol server exposing the full user-facing capability surface of the
  portfolio tracker: reads (portfolio, accounts, positions, journals, borrowing, tax,
  open items, prices), writes (recording every journal type, corrections via supersession,
  account management, facility terms, price overrides), and the import/reconciliation workflow.
- Every tool call scoped to exactly one household, authenticated with a revocable token.
- Ledger-faithful: tools delegate to `@stonks/ledger` and `@stonks/db`; no reimplemented maths.
- Uncertainty-faithful: estimates, unknown cost basis, missing FX, and stale prices are flagged
  in every response that contains them — an agent must not be able to mistake an estimate for a fact.
- Deployable on Vercel today, self-hostable tomorrow, with no cloud-specific dependency.

### Non-goals

- **Credential/administration surface.** The MCP deliberately does NOT expose: creating or
  revoking API tokens, changing the household password or username, or creating households.
  Rationale: an agent that can mint its own credentials or rotate the household password can
  escalate and lock out the human. These stay in the authenticated web UI only. This is the one
  deliberate narrowing of "anything a user can do".
- **Deleting or editing history.** Not a narrowing — the app itself has no such capability.
  Journals are immutable; the correction path is supersession, and the MCP exposes exactly that.
- Multi-tenant OAuth authorization server (see Open questions).
- Live broker connectivity (the app's import is fixture/stub-driven; the MCP exposes that workflow).

---

## 2. Transport decision

**Decision: Streamable HTTP, served from a Next.js route handler at `apps/web/app/api/mcp/[transport]/route.ts`, using the `mcp-handler` adapter over the official `@modelcontextprotocol/sdk`, in stateless mode.**

Rationale:

- Streamable HTTP is the current MCP remote transport; SSE is deprecated. `mcp-handler`
  (formerly `@vercel/mcp-adapter`) wraps the official TypeScript SDK's server classes in a
  fetch-style handler that runs identically as a Vercel function and inside a self-hosted
  `next start` / Docker container — one code path for both deploy targets, satisfying the
  self-hosting constraint without giving up Vercel.
- Using the raw SDK directly would require adapting its Node `http` server semantics to the
  App Router request model by hand; `mcp-handler` is that adapter, maintained, and thin. The
  domain logic (tool implementations) depends only on the SDK's `McpServer` registration API,
  so swapping the adapter later is contained to one file.
- **Stateless mode** (no session store, no Redis): each request carries its own bearer token
  and the server holds no per-session state. This is what makes serverless-on-Vercel and
  single-container self-host equally trivial. Consequence: no server-initiated notifications
  (resource-updated pushes). Acceptable for v1 — agents poll.
- STDIO is not offered: the server needs the household database and must enforce auth; a
  local STDIO binary would bypass the app's boundary. (A user self-hosting on localhost simply
  points their agent at `http://localhost:3000/api/mcp`.)

`apps/web/middleware.ts` must exempt `/api/mcp` from the cookie-auth redirect; the MCP layer
performs its own bearer-token auth (below).

## 3. Authentication and authorization

**Decision: household-scoped personal access tokens (PATs), presented as `Authorization: Bearer <token>`, stored hashed, with read-only vs read-write scope and instant revocation.**

The signed session cookie is a browser credential; a headless agent needs a long-lived,
individually revocable secret. Full OAuth 2.1 (dynamic client registration, PKCE, consent
screens) is disproportionate for a single-household self-hosted app whose "user directory" is
one row; PATs are the recommended approach. (Revisit if the app ever becomes multi-user SaaS —
see Open questions.)

Model:

- New table `api_token`:
  `id uuid PK, household_id uuid FK→household NOT NULL, name text NOT NULL, token_hash text NOT NULL UNIQUE, scope text NOT NULL CHECK (scope IN ('read','read_write')), created_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz`.
- Token format `stk_<32 bytes base64url>`; the plaintext is shown exactly once at creation and
  only the SHA-256 hash is stored. Lookup is by hash (constant-time compare not required since
  the hash itself is the index key and unguessable).
- Tokens are created/revoked **only** in the web UI (settings page + `POST/DELETE
  /api/tokens`, cookie-authenticated) — never via MCP (see Non-goals).
- Every MCP request: resolve token hash → row; reject if missing or `revoked_at` set; stamp
  `last_used_at`; derive `{ householdId, scope }` into the request context. **Every repository
  call downstream takes that `householdId`** — the same isolation discipline the web app uses.
  Cross-household access is a security defect; the test suite includes explicit negative tests
  (token A must never read or write household B's rows, including by guessing journal/account ids:
  lookups are always `WHERE household_id = ? AND id = ?`).
- Scopes: `read` may call read-only tools and read resources; `read_write` may also call
  mutating tools. Enforced centrally by the tool registrar (each tool declares its required
  scope; the wrapper rejects before the handler runs), not per-handler by convention.

## 4. Money and quantity typing — the binding schema rule

JSON numbers are IEEE-754 doubles. The domain forbids `number` on money/quantity paths.
Therefore, in **every** tool input schema and output payload:

- Monetary amounts are **strings of integer minor units** (`"amountMinor": "-1500000"`),
  always accompanied by a currency code, validated by a shared Zod schema
  `zMinorAmount = z.string().regex(/^-?\d+$/)` and parsed with `BigInt(...)`.
- Quantities are **fixed-scale decimal strings** validated by
  `zQuantity = z.string().regex(/^-?\d+(\.\d{1,8})?$/)` and parsed with `qtyFromDecimalString`.
- FX rates are rational `{ fxRateN: string, fxRateD: string }` (bigint strings), never a float.
- A tool schema that types an amount, quantity, or rate as `z.number()` is a **correctness bug**
  and fails review. The shared schemas live in one module (`apps/web/lib/mcp/schemas.ts`) so no
  tool hand-rolls its own.

Outputs mirror this: all money in structured content is minor-unit strings + currency +
`minorUnits` scale. Human-readable text content may include formatted figures via the existing
`lib/format.ts` boundary.

## 5. Uncertainty contract

Every response that carries a derived value carries its uncertainty alongside, mapped from the
domain's own representations:

- Positions: `costIsUnknown: boolean` (from `isUnknownCost`); when true, all cost-dependent
  fields (gain, net return) are `null` with `"reason": "UNKNOWN_COST_BASIS"` — never `"0"`.
- Interest: modelled figures are tagged `"basis": "MODELLED"`; actual posted interest
  `"basis": "ACTUAL"`; variance responses carry both (from `interestVariance`).
- Prices: `resolvePrice` output carries `source` and `asOf`; responses include a
  `stale: boolean` when `asOf` is older than the requested date.
- Tax summaries carry `TaxFlag[]` verbatim plus the fixed disclaimer string
  `"This is not tax advice."` in the text content.
- Traceability: derived DTOs include `sourceJournalIds` where the read model provides them.

## 6. Write safety

Classification and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`):

| Class | Operations | Annotations | Protocol story |
|---|---|---|---|
| Read | all `get_*` / `list_*` tools | `readOnlyHint: true` | Available at `read` scope. |
| Additive write | `record_journal`, `record_statement`, `set_price_override`, `create_account`, `set_facility_terms`, `add_benchmark_rate_point`, `create_import_batch` | `readOnlyHint: false, destructiveHint: false` | Ledger is append-only; every write is reversible via supersession or a later effective-dated row. Requires `read_write`. |
| Hard-to-reverse | `supersede_journal`, `commit_import_batch`, `close_account` | `destructiveHint: true` | Not physically destructive (history retained), but they change what "effective" means and (for commit) post many journals at once. Each requires an explicit `confirm: true` input field; without it the tool returns a preview of what would change and does nothing. |
| Excluded | token/password management, physical deletion | — | Not exposed at all (§1 Non-goals). |

Duplicate-submission guard: `record_journal` accepts optional `externalNaturalKey`; when
present and already existing for the household, the tool returns the existing journal id with
`duplicate: true` instead of double-posting (idempotency for retrying agents).

## 7. Reuse map — who delegates to what

| Tool family | Delegates to | Exists today? |
|---|---|---|
| Portfolio/accounts/positions/open-items/series reads | `apps/web/lib/portfolio.ts` `getPortfolioSnapshot` → `portfolio-derive.ts` `derivePortfolioSnapshot` (treat shape, not lines, as stable — under active extension) | Yes |
| Journal history | `createJournalRepo(db).listPosted` + `sortJournals` | Partially — needs `listAll` (incl. superseded, with filters) and `getById`: **prerequisite** |
| Recording journals | `assertJournalBalanced`, `assertFacilityUseComplete`, `createJournalRepo(db).insertPosted` | Yes |
| Corrections | supersession — needs `journalRepo.supersedePosted(oldId, replacement)` (transaction: mark old `SUPERSEDED`, insert replacement with `supersedesJournalId`): **prerequisite** |
| Borrowing/interest | `replayFacilitySlices`, `facilitySlicesAsOf`, `sumSlices`, `modelInterest`, `rateBpsOnDate`, `interestVariance`, `attributeInvestmentInterest` | Ledger yes; needs a facility-terms repo (read `credit_facility_terms`, `benchmark_rate_point`): **prerequisite** |
| Tax | `summarizeCanadaTaxYear` (via the read model's `taxSummary`) | Yes |
| Import/reconcile | `matchImportCandidates`, `reconcileStatement` + repos over `statement`, `import_batch`, `import_candidate`, `reconciliation_result`: repos are **prerequisites** |
| Prices | `resolvePrice`, `MarketDataProvider` (`FixtureMarketDataProvider` today) + repo over `price_quote`/`price_override` tables: **prerequisite** (tables are in the design spec §5.6; verify presence in `packages/db/src/schema` and add if absent) |
| Accounts admin | account repo (`create`, `close`, `list`): **prerequisite** |

No tool computes a balance, cost basis, or interest figure itself; anything not in
`@stonks/ledger`'s public API is a prerequisite task in the plan, not an inline reimplementation.

## 8. Tool catalogue

All inputs additionally validated for household ownership of every referenced id.
Common output envelope: `structuredContent` with typed payload + short text summary.

### Reads (scope: `read`)

1. **`get_portfolio_overview`** — in: `{}`. Out: net worth, total invested, total borrowed
   (minor strings + currency), balances by account type, open-item count, allocation (bps,
   basis labelled `"COST"`), value-over-time series. Delegates: `getPortfolioSnapshot`.
2. **`list_accounts`** — in: `{ includeClosed?: boolean }`. Out: accounts with type, currency,
   tax treatment, replay balance (minor string), closed_at. Delegates: snapshot + account repo.
3. **`list_positions`** — in: `{ accountId?: string }`. Out: position rows (qty decimal string,
   cost minor string | null, `costIsUnknown`, trade currency, realized gains to date,
   attributed borrow cost when derivable). Delegates: snapshot / `applyPositionsForJournal` replay.
4. **`list_journals`** — in: `{ type?, accountId?, from?, to?, includeSuperseded?: boolean, limit?, cursor? }` (dates `YYYY-MM-DD`). Out: journal headers + postings, superseded ones
   explicitly marked with `status` and `supersedesJournalId`. Delegates: journal repo `listAll`.
5. **`get_journal`** — in: `{ journalId }`. Out: full journal with postings, facility uses,
   supersession chain (what it supersedes / what superseded it). Delegates: repo `getById`.
6. **`get_borrowing_summary`** — in: `{ facilityAccountId?, asOf? }`. Out: per facility —
   balance owed, use-slice breakdown (`FACILITY_USES`), effective rate, modelled vs actual
   interest with variance, each figure tagged `MODELLED`/`ACTUAL`. Delegates:
   `replayFacilitySlices`/`sumSlices`, `modelInterest`, `interestVariance`.
7. **`get_interest_attribution`** — in: `{ from, to }`. Out: investment-use interest allocated
   to positions by dollar-days. Delegates: `attributeInvestmentInterest`.
8. **`get_tax_year_summary`** — in: `{ year: number, jurisdiction?: "CA" }`. Out:
   `TaxYearSummary` + `TaxFlag[]` + disclaimer. Delegates: `summarizeCanadaTaxYear`.
9. **`list_open_items`** — in: `{ severity? }`. Out: data-quality findings (unknown basis,
   missing FX, interest variance, reconciliation mismatch) with trace ids. Delegates: snapshot `openItems`.
10. **`get_price`** — in: `{ securityId, currency, asOf? }`. Out: resolved price with `source`
    (`QUOTE`/`OVERRIDE`), `asOf`, `stale` flag; error `PRICE_NOT_FOUND` when absent. Delegates: `resolvePrice`.
11. **`list_import_batches`** / **`get_import_batch`** — batch status, candidates with
    `match_state` (`NEW`/`DUPLICATE`/`CONFLICT`). Delegates: import repos + `matchImportCandidates`.
12. **`get_reconciliation`** — in: `{ statementId }`. Out: computed vs stated balance,
    `MATCH`/`MISMATCH`. Never adjusts anything. Delegates: `reconcileStatement`.

### Writes (scope: `read_write`)

13. **`record_journal`** — the workhorse; covers every journal type (`BUY`, `SELL`, `DIVIDEND`,
    `INTEREST_CHARGED`, `INTEREST_EARNED`, `FEE`, `TRANSFER`, `DEPOSIT`, `WITHDRAWAL`,
    `CORPORATE_ACTION`, `OPENING`). In: type, tradeDate, memo?, externalNaturalKey?,
    postings `[{ accountId, amountMinor: string, currency, quantity?: string, securityId?, tradeCurrency?, fxRateN?/fxRateD?: string }]` (≥2),
    facilityUses when a facility is drawn. Validates `assertJournalBalanced` +
    `assertFacilityUseComplete` before persisting via `insertPosted`; `sort_key` assigned
    server-side (next free key for the trade date). Out: journal id, or structured validation error.
    Opening positions with unknown cost are legal (omit cost — stays Unknown; the tool never
    substitutes zero). The tool never accepts a "balance" — only postings.
14. **`supersede_journal`** — in: `{ journalId, replacement: <record_journal input>, confirm: true }`.
    Marks old `SUPERSEDED`, posts replacement with `supersedesJournalId`, atomically. Without
    `confirm` returns a preview diff. Delegates: `supersedePosted` (prerequisite).
15. **`create_account`** — in: name, type (`INVESTMENT`/`CREDIT_FACILITY`/`RECEIVABLE`/`CASH`/`EXTERNAL`),
    currency, taxTreatment. Delegates: account repo.
16. **`close_account`** — in: `{ accountId, confirm: true }`; refuses while replay balance ≠ 0,
    naming the balance. Delegates: account repo + snapshot.
17. **`set_facility_terms`** — in: facility accountId, benchmarkId, spreadBps (int), dayCount,
    postingDayRule, capitalizeInterest, effectiveFrom. Effective-dated append, no overwrite.
18. **`add_benchmark_rate_point`** — in: benchmarkId, effectiveDate, rateBps (int — bps are
    integers, not money; `number` is acceptable here and only here among rate-like fields).
19. **`set_price_override`** — in: securityId, asOf, priceMinor: string, currency, note.
    Append-only override row. Delegates: price repo.
20. **`record_statement`** — in: accountId, periodStart/End, statedBalanceMinor: string,
    statedAsOf, sourceLabel. Creates the reconciliation input; never touches the ledger.
21. **`create_import_batch`** — in: accountId + candidate rows (fixture-format). Runs
    `matchImportCandidates`, stores batch in `PREVIEW`, returns per-candidate match states.
22. **`commit_import_batch`** — in: `{ batchId, candidateIds?: string[], confirm: true }`.
    Posts selected non-duplicate candidates as journals (each through the same
    `assertJournalBalanced` path), marks batch `COMMITTED`. `destructiveHint: true`.
23. **`reject_import_batch`** — in: `{ batchId }`. Marks `REJECTED`; nothing posted.

## 9. Resources and prompts

Resources model **stable, addressable state an agent will want as ambient context**; tools model
parameterised queries and actions. Snapshot-like reads are offered *both* ways (resource for
context-loading clients, tool for parameterised access) — cheap, since both call the same read model.

Resources (all household-scoped by the request's token; read scope):

- `stonks://portfolio/snapshot` — full `PortfolioSnapshot` JSON.
- `stonks://accounts` — account list with balances.
- `stonks://open-items` — the data-quality report (the natural "what needs attention" context).
- `stonks://reference/journal-types` — static documentation of journal types, the sign
  convention (signed debit-positive), posting shape, and worked examples drawn from
  `fixtures/ledger` — so an agent can learn to write correct journals without trial and error.

Prompts:

- `record-transaction` — guided flow: elicits type/date/accounts/amounts, reminds the agent of
  minor-unit strings and the balance invariant, then calls `record_journal`.
- `monthly-review` — walks reconciliation: fetch open items, statements, variance, propose actions.
- `correct-a-mistake` — guides supersession (find journal → build replacement → preview → confirm).

## 10. Error semantics

- Domain `ValidationError` (unbalanced journal, incomplete facility use, negative quantity,
  unknown account) → MCP tool error (`isError: true`) with structured detail:
  `{ code: "UNBALANCED_JOURNAL" | "FACILITY_USE_INCOMPLETE" | "NEGATIVE_QUANTITY" | "UNKNOWN_ACCOUNT" | "UNKNOWN_JOURNAL" | "CROSS_HOUSEHOLD_DENIED" | "SCOPE_DENIED" | "CONFIRMATION_REQUIRED" | "DUPLICATE_NATURAL_KEY" | "PRICE_NOT_FOUND" | "ACCOUNT_NOT_EMPTY", message, hint? }` —
  message states which invariant failed and, where the ledger provides it, the offending
  journal/posting ids. Never a bare 500 for a domain failure.
- Schema validation failures name the field and the expected string format (e.g. "amountMinor
  must be a string of integer minor units, got JSON number — see stonks://reference/journal-types").
- Auth failures are HTTP-level: 401 (missing/invalid/revoked token) before any MCP processing;
  scope failures are tool errors (`SCOPE_DENIED`) so the agent can report them legibly.
- Unexpected exceptions → generic tool error with a correlation id logged server-side; no stack
  traces or SQL in responses.

## 11. Security analysis

- **Tenant isolation** is the top risk. Mitigations: householdId comes only from the token row;
  every repo query filters by it; ids in inputs are looked up with
  `household_id = ? AND id = ?`; negative tests are mandatory (plan Task 13).
- **Token leakage**: hashed at rest, shown once, revocable, `last_used_at` visible in UI;
  recommend `read` scope by default in the UI.
- **Privilege escalation**: no credential-management tools exposed (§1); scope enforced by the
  registrar wrapper, not per-handler discipline.
- **Financial integrity**: writes go through the same domain validators as the web app; the
  MCP cannot post an unbalanced journal, mutate history, or store a computed balance because
  no code path exists for it.
- **Prompt-injection blast radius**: destructive-hinted tools require `confirm: true`, giving
  the agent's host a natural human-in-the-loop checkpoint; annotations let well-behaved hosts
  gate on `destructiveHint`.
- **Transport**: HTTPS in production (Vercel default; self-hosters put a TLS proxy in front —
  document it). Bearer tokens never in URLs.
- **Rate limiting**: out of scope for v1 (single household, personal agents); note for later.

## 12. Owner decisions (RESOLVED 2026-08-02 — binding)

All questions below were put to the product owner and answered. These are decisions, not
options. Implementers follow them; reviewers enforce them.

1. **Auth: personal access tokens. No OAuth layer in v1.** Build the PAT model exactly as
   specified in §3. Keep token verification isolated behind a single module so an OAuth
   layer could be added later without touching any of the 23 tool implementations — but do
   not build OAuth scaffolding now, and do not add discovery endpoints "just in case".
2. **Confirmation gates stay.** `supersede_journal`, `commit_import_batch`, and
   `close_account` require `confirm: true` and return a no-op preview without it, exactly as
   §6 specifies. This is the human-in-the-loop checkpoint that bounds prompt-injection blast
   radius; it is not negotiable at implementation time.
3. **Prices: manual overrides only.** `set_price_override` is in. **`record_price_quote` is
   NOT to be built** — no agent-fed quote channel. Agent-supplied prices must remain visibly
   distinct from provider quotes, and `resolvePrice`'s `source` must always tell them apart.
4. **The missing schema is in scope.** Create the `price_quote` / `price_override` and
   `security` / `security_symbol` tables and migrations as prerequisite tasks, so the full
   tool catalogue works rather than shipping visibly broken capabilities.
5. **Journal reorder (`sort_key` rewrite) stays excluded**, as originally designed. It is
   easy to misuse, rarely needed, and remains a web-UI admin operation. Do not expose it.

## 13. Original open questions (superseded by §12)

1. **OAuth vs PAT.** The MCP spec's authorization framework is OAuth 2.1; some hosted MCP
   clients (e.g. claude.ai remote connectors) prefer or require OAuth discovery. PATs are
   recommended here for the self-hosted single-household reality, and most clients accept a
   static bearer header — but if you specifically want to connect claude.ai's hosted connector
   UI, an OAuth layer may become necessary. Confirm the target client(s).
2. **Should `commit_import_batch` and `supersede_journal` require confirmation (`confirm: true`)
   as designed, or do you want your agent to run them unattended?**
3. **Price quote ingestion**: should the MCP expose a `record_price_quote` write (agent pushes
   prices from its own sources), or are quotes provider-only? Spec currently exposes overrides
   only; an agent-fed quote channel would be genuinely useful but blurs the provider boundary.
4. **Journal reorder** (`sort_key` rewrite) is an audited admin operation in the design spec.
   Exposed to agents, or web-UI only? Currently **excluded** pending your call — it is easy to
   misuse and rarely needed.
5. The `price_quote`/`price_override` and `security`/`security_symbol` tables from design spec
   §5 may not all exist in `packages/db/src/schema` yet; the plan makes creating the missing
   ones a prerequisite task. Confirm that is in-scope rather than blocked on other work.
