# Plan 7: Import Stub + Reconciliation

**Goal:** Fixture-driven import candidate matching and statement reconciliation — domain only, never auto-adjust books.

**Status:** Implemented in `packages/ledger/src/import/`.

## Scope

- `Statement` — broker-stated balance for a period
- `ImportCandidate` — proposed journal with `externalNaturalKey`
- `matchImportCandidates` — NEW / DUPLICATE / CONFLICT by key + posting amount JSON
- `reconcileStatement` — MATCH / MISMATCH vs ledger replay balance
- Fixtures: `fixtures/import/sample-statement.json`, `fixtures/import/sample-candidates.json`

## DB stubs

Minimal Drizzle tables under `packages/db/src/schema/`:

- `statement`
- `import_batch` (PREVIEW | COMMITTED | REJECTED)
- `import_candidate` (match_state enum)
- `reconciliation_result` (MATCH | MISMATCH)

Migration `0002_import_reconciliation.sql` added manually (drizzle-kit generate requires live DB).

## Tests

`packages/ledger/tests/import-reconcile.test.ts`

## Out of scope

- PDF parsers, live broker APIs
- Auto-commit or book adjustment on mismatch
- Import UI (Plan 8)
