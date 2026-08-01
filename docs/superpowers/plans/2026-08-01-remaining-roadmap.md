# Remaining Roadmap Implementation Notes (Plans 4–9)

> Consolidated record of Phase 4–9 delivered on `cursor/complete-roadmap-1dad`.

**Spec:** `docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md`

| Plan | Deliverable | Location |
|------|-------------|----------|
| 4 | Dollar-day attribution + FX gain decomposition | `packages/ledger/src/interest/dollar-days.ts`, `packages/ledger/src/fx/` |
| 5 | Openings, unknown cost, corporate actions | `positions.ts` + `cost-basis-state.ts`, `CorporateAction` on `Journal` |
| 6 | Canada tax (flag-only) | `packages/ledger/src/tax/` |
| 7 | Import stub + reconciliation | `packages/ledger/src/import/` |
| 8 | HeroUI dark UI | `apps/web` pages + demo portfolio |
| 9 | Market data provider + charts | `packages/ledger/src/market/`, `/charts` page |

## Phase 4–9 definition of done

- [x] Dollar-day allocateExact of investment-use interest across positions
- [x] FX decomposition: asset + currency = total gain (exact)
- [x] Unknown opening cost propagates; sells do not invent zero cost gains
- [x] Split / ROC corporate actions
- [x] Canada tax summary with disclaimer + superficial-loss flags only
- [x] Import match NEW/DUPLICATE/CONFLICT; reconcile MATCH/MISMATCH (no auto-adjust)
- [x] Dark HeroUI OSS shell: overview, entry, ledger, positions, open items, tax, charts
- [x] Fixture market data provider; charts page with allocation + value series
- [x] Demo mode for preview without Postgres
