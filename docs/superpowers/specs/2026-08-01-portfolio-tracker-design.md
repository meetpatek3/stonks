# Investment Portfolio Tracker — Design Spec

**Date:** 2026-08-01  
**Status:** Draft for review  
**Product question:** For each position, what did I actually make after commissions, currency, and the interest on money borrowed to hold it?

---

## 1. Goals and non-goals

### Goals

- Self-hosted personal investment tracker for one household.
- Double-entry ledger as the sole source of truth; balances and positions are derived.
- Correct cost basis (ACB and FIFO), borrowing-cost modelling with use attribution, FX gain decomposition, and Canada-first tax reporting.
- Uncertainty is first-class: never invent cost basis or force reconciliations.
- Every derived number is traceable to the journals that produced it.

### Non-goals (v1)

- Multi-tenant SaaS or per-user separate ledgers.
- Live broker APIs or production PDF parsers (import is fixture-driven stub).
- Automated application of wash-sale / superficial-loss / contribution-limit adjustments (flag only).
- Tax advice; tax views carry an explicit disclaimer.

---

## 2. Decisions locked in discovery

| Topic | Decision |
|-------|----------|
| Tenancy | Single household / one ledger; `household` row as future expansion point |
| Tax | Canada module first; US (and others) as stub interface |
| Stack | TypeScript end-to-end, Postgres, modular monolith |
| Auth | Local trust; optional shared password |
| Facility use | Explicit use required on every credit-facility draw (`INVESTMENT` / `LENDING` / `PERSONAL` / `OTHER`) |
| Import | Manual entry first; import stub with fixtures + diff/reconcile UX |
| Architecture | Approach A: Next.js app + pure domain package + Docker Compose |

---

## 3. Architecture

### 3.1 Shape

Modular monolith:

- `packages/ledger` — pure domain (no React, no DB drivers). Money, journals, replay, cost basis, interest, FX, jurisdiction plugins, property tests.
- `packages/db` — Drizzle schema, migrations, repositories that map rows ↔ domain types.
- `apps/web` — Next.js App Router: UI + route handlers calling domain through repositories.
- `docker-compose.yml` — `postgres` + `web`.
- `fixtures/` — worked examples and import samples.

### 3.2 Why not alternatives

- **API + SPA:** extra process/CORS cost without benefit for single-household self-host.
- **Full event sourcing:** immutable journals + supersession already provide auditability; ES projections add complexity without changing the accounting model.

### 3.3 Runtime principles

- Domain functions are pure: `(state, journal) → newState | ValidationError`.
- Persistence is an adapter; tests for engines use in-memory journals.
- Caches (`position_snapshot`, `balance_snapshot`) are optional accelerators keyed by `ledger_version`; never user-editable.

---

## 4. Domain model

### 4.1 Household / book

One per install in v1.

- Reporting currency (e.g. CAD)
- Default cost-basis method (`ACB` | `FIFO`; Canada default `ACB`)
- Optional `auth_password_hash`
- Timezone / calendar reference for modelled interest posting-day shifts

### 4.2 Security identity

- Canonical identity is `security_id`, not ticker string.
- `security_symbol` rows carry symbol/exchange with validity intervals (renames, exchange moves, dual listings).
- Currency-conversion trades (e.g. Norbert’s Gambit) are two legs of the **same** security in different currencies.

### 4.3 Accounts

| Type | Role |
|------|------|
| `INVESTMENT` | Brokerage; cash + positions |
| `CREDIT_FACILITY` | Liability; balance owed |
| `RECEIVABLE` | Asset; money lent out |
| `CASH` | Bank account |
| `EXTERNAL` | Boundary of the tracked world |

Also: currency, tax treatment (`TAXABLE` | `TAX_DEFERRED` | `TAX_FREE`), optional contribution-limit policy reference.

### 4.4 Money and quantities

- **Currency amounts:** integer minor units (`bigint`) + currency code. Scale from `currency.minor_units`. Never IEEE floats in domain or DB for money.
- **Quantities:** fixed-scale decimal, at least 8 fractional digits (`numeric(28,8)`).
- **FX rates:** exact rational (numerator/denominator bigints) or equivalently a decimal type that does not round-trip through binary float.
- Domain TypeScript types wrap these; `number` is forbidden for money/qty in `packages/ledger`.

### 4.5 Journals and postings

**Journal types (minimum):**  
`BUY`, `SELL`, `DIVIDEND`, `INTEREST_CHARGED`, `INTEREST_EARNED`, `FEE`, `TRANSFER`, `DEPOSIT`, `WITHDRAWAL`, `CORPORATE_ACTION`, `OPENING`.

**Journal header:** type, trade date, `sort_key` (stable same-day order), memo, optional `external_natural_key`, source (`MANUAL` | `IMPORT` | `SYSTEM`), status (`POSTED` | `SUPERSEDED`), optional `supersedes_journal_id`.

**Postings:** ≥2 per journal; each has account, signed `amount_minor`, optional `security_id` + `quantity`, trade currency, reporting-currency amount, optional per-leg FX.

A purchase funded from a credit facility is **one journal** (facility liability increases; investment position/cash increases). The user never records two halves that can drift.

**Facility use:** any journal that draws on / increases utilization of a `CREDIT_FACILITY` **must** include `journal_facility_use` lines covering 100% of the draw (`INVESTMENT` | `LENDING` | `PERSONAL` | `OTHER`). No inference from destination account type.

### 4.6 Positions and cost basis

- Derived by replaying journals in order `(trade_date, sort_key, id)`.
- Methods: **ACB** (average cost / adjusted cost base) and **FIFO**, selectable (household default; overridable where jurisdiction requires).
- Cost tracked simultaneously in **trade currency** and **reporting currency** (rate on each trade date).
- Path-dependent: buy updates running state; sell removes cost at the method’s rule *at that moment*.

### 4.7 Uncertainty

```text
CostBasisState = Known(Money) | Unknown
```

Opening positions may omit cost. Unknown propagates into any derived gain/loss that depends on it. Never treat missing cost as zero.

### 4.8 Corrections

Immutable ledger:

- Preferred: reversing journal + replacement journal.
- Or: supersession (`status = SUPERSEDED`, retained for audit; effective replay skips superseded).
- No destructive in-place mutation of posted economics without audit.

### 4.9 Interest

- Accrues **daily** on closing balance of each **use-slice** parallel balance (same rate → slices sum exactly to whole).
- Rate = benchmark (effective-dated history) ± spread (bps).
- Day-count: `ACT/365`, `ACT/360`, `ACT/ACT`.
- Posting day configurable; weekends/holidays may shift modelled post date; when actual statement date known, post on actual date.
- Capitalize into balance **or** pay separately (facility terms).
- **Actual `INTEREST_CHARGED` always wins for books.** Model runs alongside for reconciliation variance.

### 4.10 Borrowing-cost attribution to positions

1. Split interest by use-slice (parallel accrual).
2. Allocate the `INVESTMENT` slice across positions by **dollar-days** (amount × days held) in the period.
3. Position views show return before and after allocated borrow cost.

### 4.11 FX and gains

- Per-journal FX: confirmation rate if provided, else dated lookup.
- Decompose total gain into **asset movement** + **currency movement**; property-tested to sum exactly.
- Dual-currency trades share `security_id`.

### 4.12 Corporate actions and awkward reality

Represent explicitly as journal types / payloads (do not corrupt quantities silently):

- In-kind transfer (cost basis carries)
- Transfer out to untracked institution
- Split / consolidation
- Return of capital (reduces cost basis)
- Share lending (no economic/qty effect — explicit no-op type or flag)
- Symbol/exchange change (`security_symbol` validity, not a new security)
- **Opening position:** quantity + optional cost; unknown cost allowed

### 4.13 Tax (pluggable)

Interface: `JurisdictionModule` with Canada implementation first.

Per calendar year (Canada):

- Realized gains/losses (ACB)
- Taxable inclusion rate (configurable)
- Dividend and interest income
- Deductible interest expense from **investment-use** attribution (use matters, not who borrowed)

Flag only (do not silently apply): superficial loss, contribution limits, withdrawal room restored in a later year.

UI: “This is not tax advice” on tax figures.

---

## 5. Schema (Postgres)

Migrations via Drizzle from day one. No float money columns.

### 5.1 Reference / config

- `currency(code, minor_units, name)`
- `household(id, reporting_currency, default_cost_basis_method, auth_password_hash, timezone, …)`
- `security(id, name, asset_class, …)`
- `security_symbol(security_id, symbol, exchange, valid_from, valid_to)`
- `benchmark_rate(id, name)`
- `benchmark_rate_point(benchmark_id, effective_date, rate_bps)`
- `calendar_holiday(calendar_id, date, name)` (optional)
- `contribution_policy(id, …)` — stub for TFSA/RRSP flagging

### 5.2 Accounts and facilities

- `account(id, household_id, type, currency, tax_treatment, name, contribution_policy_id, closed_at, …)`
- `credit_facility_terms(account_id, benchmark_id, spread_bps, day_count, posting_day_rule, capitalize_interest, effective_from, effective_to)`

### 5.3 Ledger

- `journal(id, household_id, type, trade_date, sort_key, memo, external_natural_key, source, status, supersedes_journal_id, created_at, …)`
  - Unique `(household_id, trade_date, sort_key)` among non-superseded rows (or enforce in domain with clear reorder API).
- `posting(id, journal_id, account_id, amount_minor, quantity, security_id, trade_currency, reporting_amount_minor, fx_rate_n, fx_rate_d, …)`
- `journal_facility_use(journal_id, use, amount_minor | weight)` — covers 100% of draw
- `audit_event(…)`

### 5.4 Derived caches

- `position_snapshot(account_id, security_id, as_of, qty, cost_trade_*, cost_reporting_*, cost_basis_state, method, ledger_version)`
- `balance_snapshot(account_id, as_of, amount_minor, ledger_version)`
- `interest_model_run(facility_id, period_start, period_end, modelled_minor, actual_posted_minor, variance_minor)`

### 5.5 Import stub

- `statement(account_id, period_start, period_end, stated_balance_minor, stated_as_of, source_label)`
- `import_batch(status: PREVIEW | COMMITTED | REJECTED, …)`
- `import_candidate(…, match_state: NEW | DUPLICATE | CONFLICT)`
- `reconciliation_result(statement_id, computed_balance_minor, stated_balance_minor, status: MATCH | MISMATCH)`  
  **Never** auto-adjust books to force a match.

### 5.6 Prices

- `price_quote(security_id, currency, as_of, price_*, source, fetched_at)`
- `price_override(security_id, as_of, price_*, note)`

### 5.7 Sign convention

Documented and tested once:

- Signed amounts: asset/expense increase = positive (debit); liability/equity/income increase = negative (credit) **or** the inverse — pick one in implementation and never mix.
- Credit facility “balance owed” is displayed as a positive liability to humans; storage follows the single signed convention.

---

## 6. Invariants

1. Every `POSTED` journal has ≥2 postings; `reporting_amount_minor` sums to 0.
2. Balances and positions are pure functions of posted journals in deterministic order.
3. Replay must not produce negative security quantity; on violation, surface a validation error naming the journals — never silent reorder, never hide negativity.
4. Same-day order is `sort_key` only; user-visible reorder is an explicit audited operation.
5. Facility draws require facility-use allocation covering 100%.
6. Actual interest charged overrides the model for books; variance is informational.
7. `Unknown` cost basis propagates; gains are `Unknown`, not `0`.
8. Corrections append or supersede; history is retained.
9. Asset movement + currency movement = total gain (exact).
10. Sum of use-slice modelled interest = modelled total interest for the facility (exact).

---

## 7. Engine pipeline

```text
Posted journals
  → validate (order, balance, non-negative qty, facility use)
  → balances
  → positions + cost basis (ACB | FIFO, dual currency)
  → interest model per use-slice (+ variance vs actual posts)
  → dollar-day attribution of investment-use interest to positions
  → FX gain decomposition
  → jurisdiction module (Canada)
  → read models / UI
```

Traceability: every derived DTO includes `source_journal_ids` (and lot/slice ids where applicable) so the UI can show “what went into this number.”

---

## 8. Interface (after core)

Responsive web (desktop + mobile):

- **Fast transaction entry** — under ~15s on phone; defaults + recently used values.
- Portfolio overview
- Per-position detail with full cost breakdown (gross vs net of borrow cost, labeled)
- Transaction ledger with filters
- Account balances
- Tax year summary (disclaimer)
- Open items / data quality (unknown basis, reconcile mismatches, model variance, validation errors)

Charts (after numbers trusted): allocation, value over time, benchmark comparison. Default returns **net of all costs**, gross available, clearly labeled.

Auth: optional password; suitable behind localhost/LAN or reverse proxy later.

---

## 9. Testing strategy

- **Worked examples** calculated independently (spreadsheet or hand), not snapshots of current code.
- **Property-based tests** (e.g. fast-check):
  - Derived cash balances match ledger fold
  - Asset + currency movement = total gain
  - Use-slice interest sums to total modelled interest
- **Ugly cases:** same-day ordering; sell before buy → error; currency-conversion trade same `security_id`; in-kind transfer carries basis; unknown opening cost propagates; benchmark rate change mid-statement period; actual interest vs model variance.

---

## 10. Build order

1. Money types + double-entry ledger post/replay + invariants (tests)
2. Positions + ACB/FIFO with worked examples (trade + reporting currency)
3. Interest engine (variable rates, day-count, capitalize/pay) + use slices + variance vs actual
4. Dollar-day attribution to positions
5. FX + gain decomposition + dual-listed identity
6. Opening positions, unknown cost, corporate-action journal representations
7. Canada tax module (flag-only superficial loss / contribution)
8. Import stub + reconciliation report on fixtures
9. Minimal UI: entry, ledger, positions, open items, tax summary
10. Market data provider interface + overrides + charts

**Core done when:** accounting invariants hold under tests above; reconciliation report exists for fixture statements; UI may still be minimal.

---

## 11. Open items deferred (explicit)

- Broker-specific CSV/PDF parsers (after stub)
- US jurisdiction implementation beyond interface stub
- Hardening optional password / proxy SSO
- Contribution-room full engine (flag-only first)
- Multi-household on one install

---

## 12. Disclaimer

Tax figures are computational aids from user-provided data and configurable rules. The application is not a tax advisor and must state that wherever tax outputs appear.
