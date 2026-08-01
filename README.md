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

Open [http://localhost:3000](http://localhost:3000). API smoke checks:

- [http://localhost:3000/api/health](http://localhost:3000/api/health)
- [http://localhost:3000/api/ledger/balances](http://localhost:3000/api/ledger/balances)

## Documentation

| Document | Description |
|----------|-------------|
| [Design spec](docs/superpowers/specs/2026-08-01-portfolio-tracker-design.md) | Product goals, architecture, and domain rules |
| [Ledger foundation plan](docs/superpowers/plans/2026-08-01-ledger-foundation.md) | Phase 1 implementation plan and task breakdown |
| [Positions + cost basis plan](docs/superpowers/plans/2026-08-01-positions-cost-basis.md) | Phase 2 ACB/FIFO dual-currency positions |

## Phase 1 definition of done

Track progress in the [ledger foundation plan](docs/superpowers/plans/2026-08-01-ledger-foundation.md#phase-1-definition-of-done):

- [x] `@stonks/ledger` unit + property tests green
- [x] Worked deposit/transfer fixture balances match hand calculation
- [x] Same-day ordering and sell-before-buy tests green
- [x] Docker Postgres migrates; journal repo round-trip works
- [x] Next health + balances API responds
- [x] No `number` used for money in `packages/ledger` or money columns in DB

## Phase 2 definition of done

Track progress in the [positions + cost basis plan](docs/superpowers/plans/2026-08-01-positions-cost-basis.md#phase-2-definition-of-done):

- [ ] ACB worked fixture matches hand calculation
- [ ] FIFO worked fixture matches hand calculation
- [ ] Dual-currency ACB fixture matches hand calculation
- [ ] Replay exposes `positions` + `realized`
- [ ] Property tests green
- [ ] No `number` for money/qty/cost paths in new ledger code

## Monorepo layout

```
apps/web/          Next.js App Router shell
packages/ledger/   Pure TypeScript double-entry domain
packages/db/       Drizzle ORM + Postgres schema and migrations
```
