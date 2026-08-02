# Stonks — agent context

Self-hosted portfolio tracker. Double-entry ledger is source of truth; balances/positions are derived by replay (`@stonks/ledger`), not stored as snapshots.

## Layout

- `apps/web` — Next.js 15 App Router UI + API routes
- `packages/ledger` — pure domain (money as `bigint` minors, journals, ACB/FIFO)
- `packages/db` — Drizzle schema/migrations + journal repo
- `fixtures/ledger` — worked JSON examples

## Stack

- UI: HeroUI v3 (`@heroui/react`) + HeroUI Pro (`@heroui-pro/react`) on the stock HeroUI **default dark** theme — no custom CSS. `apps/web/app/globals.css` must contain only the three import statements (see the Task 1 plan's Global Constraints); do not add custom properties, `@theme` rules, or a custom font
- Auth: simple username/password → signed cookie (`AUTH_SECRET`, `jose`). Bootstrap first household from `AUTH_USERNAME` / `AUTH_PASSWORD` when DB empty. Credentials stored on `household.auth_username` / `auth_password_hash`
- DB: Postgres via Docker locally; **Neon** on Vercel (`DATABASE_URL`). Drizzle uses `postgres` (postgres.js) with `prepare: false` / `max: 1` on Vercel
- Package manager: pnpm workspaces. HeroUI Pro needs `HEROUI_AUTH_TOKEN` at install (Infisical key `HEROUI_AUTH_TOKEN`)

## Commands

```bash
docker compose up -d postgres
pnpm install                          # needs HEROUI_AUTH_TOKEN for Pro
pnpm migrate                          # drizzle migrations
pnpm --filter @stonks/web dev
pnpm test
```

Production: Vercel project `meetpatek/stonks`, Neon resource `stonks-db`. Login secrets live in Vercel env + Infisical project **stonks** (`STONKS_AUTH_*`) — not OpenOrchid/Nobu. Use `~/.agent-vault/bin/infisical-agent-stonks` (or `infisical … --projectId` from `.infisical.json`).

## Domain rules (do not break)

- Never use JS `number` for money/qty/cost paths in ledger or money DB columns
- Journals are immutable; corrections use supersession (`SUPERSEDED`)
- Replay order: `trade_date` then `sort_key`
- Reporting currency FX uses rational `n/d` on postings

## Deploy notes

- `vercel.json` build: `pnpm --filter @stonks/web build`
- After schema changes: migrate against Neon `DATABASE_URL` (from `vercel env pull`)
- Protected routes via `apps/web/middleware.ts`; public: `/login`, `/api/auth/login`, `/api/health`
