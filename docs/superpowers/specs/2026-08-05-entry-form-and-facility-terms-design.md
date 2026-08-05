# Entry form redesign & facility terms UI

Date: 2026-08-05  
Status: approved for planning

## Problem

Fast Entry (`/entry`) is a single From/To cash-move form for every journal type. That fits transfers, but mismatches how people record buys, sells, deposits, income, fees, and openings. Separately, credit-facility accounts can be created in the UI, but there is no way to set facility terms or benchmark rates — so Borrowing cannot model LOC interest (e.g. Prime + spread).

## Goals

1. Make each writable journal type’s form match the user’s mental model (not the posting shape).
2. Keep Fast Entry: one adaptive screen, few fields, phone-friendly.
3. Guide users when a buy lacks cash (offer a transfer first) instead of posting into a silent shortfall.
4. Let users set and update credit-facility terms and benchmark rate history from Accounts.
5. Fix SELL quantity sign on write so sells dispose shares instead of increasing them.

## Non-goals

- CORPORATE_ACTION create UI
- Facility-funded BUY path on the entry form (cash-in-account only)
- MCP write tools for facility terms / benchmarks
- Global API rejection of negative cash balances
- FX / trade-currency fields on the entry form
- Separate Benchmarks admin page

---

## Part A — Adaptive entry form

### Approach

Single `/entry` screen. Journal type selects which fields and labels appear. Submit still builds balanced postings via existing `POST /api/journals` (extended only as needed for OPENING unknown-cost and security create).

### Per-type UX

| Type | User-facing fields | Implied / hidden | Postings (debit-positive) |
|------|--------------------|------------------|---------------------------|
| **BUY** | Brokerage account, security, quantity, cost, date, memo | Funding = that account’s cash | Account: cash −cost; same account +security qty/cost |
| **SELL** | Brokerage account, security, quantity sold, proceeds, date, memo | Proceeds stay in that account | Account: security −qty/−proceeds; cash +proceeds |
| **DEPOSIT** | Into account, amount, date, memo | EXTERNAL | EXTERNAL − → account + |
| **WITHDRAWAL** | From account, amount, date, memo | EXTERNAL | Account − → EXTERNAL + |
| **TRANSFER** | From, To (household only), amount, date, memo; show cash balances | — | From − → To +; facilityUses when From is CREDIT_FACILITY |
| **DIVIDEND** | Into account, amount, optional security, date, memo | EXTERNAL | EXTERNAL − → account + (optional security attribution) |
| **INTEREST_EARNED** | Into account, amount, date, memo | EXTERNAL | EXTERNAL − → account + |
| **INTEREST_CHARGED** | Charged on account, amount, date, memo | EXTERNAL | Account − → EXTERNAL + (capitalize when that account is the facility) |
| **FEE** | Charged on account, amount, optional security, date, memo | EXTERNAL | Account − → EXTERNAL + |
| **OPENING** | Mode: Cash (account + amount) or Position (account + security + qty; cost optional / “unknown”) | No From/To | Cash: EXTERNAL ↔ account; Position: qty on account, amounts 0 when cost unknown |

### Security selection

Dropdown of securities already used by the household, plus **Add security…** (symbol/name) inline when missing. BUY, SELL, and position OPENING require a security; DIVIDEND/FEE security is optional.

### BUY shortfall → guided transfer

1. On BUY submit, compare cost to available cash in the chosen brokerage account (from current household replay / balances used elsewhere in the app).
2. If shortfall > 0: do not post the buy. Offer **Transfer cash in first** with:
   - To = brokerage (fixed)
   - From = other household account (user picks; prefer accounts with balance ≥ shortfall)
   - Amount = shortfall (editable)
3. After a successful TRANSFER, return to the BUY form with previous fields restored and re-check cash.
4. No silent negative-cash buy from this form.

### Other sufficiency checks (UI gate)

| Action | Rule |
|--------|------|
| SELL | Block if quantity > open position for that account + security |
| TRANSFER / WITHDRAWAL / FEE / INTEREST_CHARGED | Block if the paying account’s cash would go negative |
| DEPOSIT / INTEREST_EARNED / DIVIDEND | No outflow check |

These are product gates in the UI for these flows. The ledger API does not gain a global “no negative cash” invariant in this pass.

### Correctness fixes

- **SELL quantity:** UI collects a positive quantity sold; wire format uses negative quantity (and negative proceeds) on the security posting.
- **BUY / SELL:** security and quantity are required (no pure cash-move disguised as a trade).

### Facility use on transfers

When TRANSFER From is `CREDIT_FACILITY`, keep the existing facility-use allocation UI (100% coverage required). Drawing a facility to fund a brokerage remains a TRANSFER (or separate journals), not a special BUY funding path.

---

## Part B — Facility terms on Accounts

### Context

Domain and DB already exist:

- `credit_facility_terms` — benchmark, spread_bps, day_count, posting_day_rule, capitalize_interest, effective_from/to
- `benchmark_rate` / `benchmark_rate_point` — named curve + dated rate points
- Borrowing screen already reads terms + curves and surfaces “needs facility terms” when missing

Missing: any UI (or write API used by the app) to create/update them.

### UX home

On **create/edit of a CREDIT_FACILITY** account only, show a **Terms** section.

Fields:

- Benchmark — pick existing or **Create benchmark…** (name)
- Spread (bps or % — one clear input, stored as bps)
- Day count: `ACT_365` | `ACT_360` | `ACT_ACT`
- Posting-day rule: `CALENDAR_DAY` | `MONTH_END`
- Capitalize interest: yes/no
- Effective from

### Benchmark rate points (inline)

From the same facility terms UI:

- List rate points for the selected/created benchmark (date + rate)
- Add a new point when the benchmark changes (e.g. prime hike) — append history, do not overwrite prior points
- No standalone Benchmarks admin page in this pass

### Effective dating

Terms are versioned by `effective_from` / `effective_to`. Saving new terms for an account closes the previously open row (set `effective_to`) per existing domain expectations. Borrowing continues to resolve “terms as of date.”

### API

Add authenticated write endpoints (or extend accounts API) so the web UI can:

1. Create/update facility terms for a CREDIT_FACILITY in the session household
2. Create a benchmark and append rate points

Reads can reuse / thin-wrap existing repo loaders. MCP write tools are explicitly out of scope for this pass.

---

## Architecture notes

- Prefer adapting `EntryScreen` + `lib/journals.ts` defaults/posting builders over a multi-route wizard.
- Reuse household balances/positions already derived for portfolio views for sufficiency checks; do not invent a second balance source.
- Security “create” should create a durable security identity the ledger already understands (same path securities use elsewhere if one exists; otherwise minimal create used by journals today).
- Facility terms UI lives in the accounts surface already added on `feat/accounts-ui` (or its successor), not on `/entry`.

## Testing

- Unit/integration: posting builders per type (especially BUY same-account legs, SELL negated qty, OPENING unknown cost, DEPOSIT/WITHDRAWAL EXTERNAL implied)
- UI or API tests: BUY shortfall does not post; guided transfer then buy succeeds
- SELL oversell blocked
- Facility terms write: create terms + benchmark points; Borrowing derive sees effective rate instead of “needs facility terms”
- Regression: TRANSFER facilityUses still required when drawing a facility

## Success criteria

1. A user can record a buy by picking the brokerage, security, qty, and cost — without choosing From/To or EXTERNAL.
2. Short cash on buy offers a transfer back into that account, then completes the buy.
3. A sell reduces position size (qty sign correct).
4. User can attach Prime + spread (or any benchmark + spread) to an LOC from Accounts and see modelled interest on Borrowing once rate points exist.
`}