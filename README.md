# stonks

Self-hosted investment portfolio tracker with a double-entry ledger as the source of truth.

## Prerequisites

- **Node.js 22+**
- **pnpm** (see `packageManager` in root `package.json`)
- **Postgres 16** — via Docker (recommended) or a local install matching `DATABASE_URL`

## Quick start

```bash
# 1. Environment
cp .env.example .env
# Edit .env if needed (default DATABASE_URL targets Docker Postgres below)

# 2. Postgres (pick one)
docker compose up -d postgres
# OR use local Postgres and set DATABASE_URL in .env

# 3. Install dependencies
pnpm install

# 4. Run migrations
pnpm --filter @stonks/db migrate

# 5. Run tests
pnpm test

# 6. Start the web app
pnpm --filter @stonks/web dev
```

Open [http://localhost:3000](http://localhost:3000). The UI ships with a **demo portfolio** so pages work without Postgres. API smoke checks:

- [http://localhost:3000/api/health](http://localhost:3000/api/health)
- [http://localhost:3000/api/portfolio](http://localhost:3000/api/portfolio)
- [http://localhost:3000/api/ledger/balances](http://localhost:3000/api/ledger/balances)

## Documentation

| Document | Description |
|----------|-------------|
| [Design spec](docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md) | Product goals, architecture, and domain rules |
| [Ledger foundation plan](docs/superpowers/plans/2026-08-01-ledger-foundation.md) | Phase 1 implementation plan and task breakdown |
| [Positions + cost basis plan](docs/superpowers/plans/2026-08-01-positions-cost-basis.md) | Phase 2 ACB/FIFO dual-currency positions |
| [Interest engine plan](docs/superpowers/plans/2026-08-01-interest-engine.md) | Phase 3 use-slice interest model + variance |
| [Remaining roadmap (4–9)](docs/superpowers/plans/2026-08-01-remaining-roadmap.md) | Dollar-days, FX, openings, tax, import, UI, market data |

## Definition of done (Phases 1–9)

- [x] Phase 1 — ledger foundation
- [x] Phase 2 — ACB/FIFO dual-currency positions
- [x] Phase 3 — use-slice interest + variance
- [x] Phase 4 — dollar-day attribution + FX decomposition
- [x] Phase 5 — openings / unknown cost / corporate actions
- [x] Phase 6 — Canada tax (flag-only)
- [x] Phase 7 — import match + statement reconciliation
- [x] Phase 8 — HeroUI dark UI (overview, entry, ledger, positions, open items, tax)
- [x] Phase 9 — market data provider interface + charts

## Monorepo layout

```
apps/web/          Next.js App Router + HeroUI dark UI
packages/ledger/   Pure TypeScript domain (money → tax → import → market)
packages/db/       Drizzle ORM + Postgres schema and migrations
fixtures/          Hand-calculated ledger / interest / import examples
```
