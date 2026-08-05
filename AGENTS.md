# Stonks — agent context

Self-hosted portfolio tracker. Double-entry ledger is source of truth; balances/positions are derived by replay (`@stonks/ledger`), not stored as snapshots.

## Approach to Developement (This is mandatory, do not skip)

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

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
- Market data: optional `TWELVEDATA_API_KEY` selects the Twelve Data provider (`apps/web/lib/market/`). Unset — the default — uses the fixture provider, so self-hosting needs no market-data account; prices then read as unknown rather than being invented. Persisted `price_quote` rows are the cache; there is no separate caching layer

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
- Provider price strings become minor units via `decimalStringToMinor` (string + `BigInt` only, half away from zero) — never `Number`/`parseFloat`
- A price is resolved in the security's own currency; overrides win, an older quote is returned with its real `as_of` and `stale: true`, and an unavailable price is `NONE`, never substituted

## Deploy notes

- `vercel.json` build: `pnpm --filter @stonks/web build`
- After schema changes: migrate against Neon `DATABASE_URL` (from `vercel env pull`)
- Protected routes via `apps/web/middleware.ts`; public: `/login`, `/api/auth/login`, `/api/health`
