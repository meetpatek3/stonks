# MCP Task 13 — Mutation Verification Report

Branch: `claude/portfolio-tracker-ui-rebuild-436269`  
Baseline implementation: commit `5e07842`  
Verification date: 2026-08-05

## Result

All deliberate implementation mutations were detected by a covering test and
were restored. No production vulnerability survived verification. The only
retained code changes are test-strengthening changes in
`apps/web/tests/mcp-security.test.ts`.

The repository remained clean after each mutation was restored; the final
working tree contains no deliberate implementation break.

## Mutation matrix

| Guarantee | Covering test and deliberate mutation | Did the mutation fail? | Failure observed |
|---|---|---:|---|
| Tenant isolation — read collection lookup | `packages/db/tests/journal-repo-extensions.integration.test.ts`, `listAll never crosses households`; removed the `journal.householdId` predicate from `listAll` | Yes | `expected [ 'jx-b-...', … ] to deeply equal [ 'jx-dep-...', … ]`; household B's journal appeared in household A's result. The suite had 7 failures from the same unscoped query. |
| Tenant isolation — posting to an account | `apps/web/tests/mcp-integration.test.ts`, `B's read_write token cannot post into A's account`; removed the household predicate from `accountRepo.getById` | Yes | `expected undefined to be true` at `denied.isError`; the live route accepted the cross-household posting. The following list assertion also showed the malicious journal in B's history. |
| Tenant isolation — supersession write | `packages/db/tests/journal-repo-extensions.integration.test.ts`, `supersedePosted rejects an unknown or foreign target`; removed the household predicate from the transactional target lookup | Yes | `promise resolved "undefined" instead of rejecting`; the foreign journal was superseded and the replacement was inserted. |
| Tenant isolation — account close write | `packages/db/tests/account-repo.integration.test.ts`, `never closes another household's account`; removed the household predicate from the `close` update | Yes | `expected '2026-08-05T14:40:06.971Z' to be null`; the other household's account received a `closed_at` timestamp. |
| Tenant isolation — real foreign ID lookup | `packages/db/tests/journal-repo-extensions.integration.test.ts`, `getById returns ... null for a foreign id`; changed `WHERE household_id = ? AND id = ?` to `WHERE id = ?` | Yes | `expected { id: 'jx-buy-...', … } to be null`; the test supplied a real existing journal ID belonging to household A while querying as household B. |
| Authentication — unknown bearer token | `apps/web/tests/mcp-security.test.ts`, `authentication > rejects an unknown token`; changed auth to return a forged context when verification returned `null` | Yes | `expected { Object (householdId, scope) } to be null`; the forged token produced `{ householdId: "forged", scope: "read" }`. |
| Authentication — revoked bearer token | `apps/web/tests/mcp-integration.test.ts`, both revoked-token cases; removed `isNull(apiToken.revokedAt)` from the real token-repository lookup | Yes | Both cases failed with `expected 200 to be 401`; a revoked token continued to initialize the live MCP server. |
| Scope enforcement and handler non-invocation | `apps/web/tests/mcp-security.test.ts`, the four `handler never invoked` cases; removed the registrar's scope condition | Yes | All four failed with `expected "handler" to not be called at all, but actually been called 1 times`. The probes used valid payloads and also asserted zero repo calls and zero writes. |
| Confirmation gates — supersede and close | `apps/web/tests/mcp-security.test.ts`, the `confirm=undefined/false` preview cases; bypassed each confirmation branch separately | Yes | Supersession: `expected { preview: false, … } to match { preview: true, … }`. Close: the same mismatch, and the mutation had already changed the account state. |
| Journal balance validation and no-write invariant | `apps/web/tests/mcp-security.test.ts`, both unbalanced journal cases; bypassed `assertJournalBalanced` | Yes | `expected [ { repo: 'journalWrites', … } ] to deeply equal []`; the unbalanced record attempted `insertPosted`, and the unbalanced replacement attempted `supersedePosted`. |
| Server-assigned sort key | `apps/web/tests/mcp-security.test.ts`, `a client-supplied sortKey is never honoured`; changed the schema to accept `z.number()` and used the client value | Yes | The top-level `sortKey` call returned a successful recorded journal, so `err(result)` failed with `expected undefined to be true`. |
| Privilege boundary — registry cannot expose token data | `apps/web/tests/mcp-security.test.ts`, registry-derived credential-surface check; temporarily registered a `list_tokens` tool returning dummy token data | Yes | `tool "list_tokens" must not be on the credential surface: expected 'list_tokens' not to match /token|password|credential|secret|rev…/i`. The check enumerates `MCP_TOOLS`; it does not use a hardcoded tool-name list. |
| Money typing at the protocol boundary | `apps/web/tests/mcp-security.test.ts`, recursive registry schema inventory; changed `record_journal.postings[].amountMinor` from `zMinorAmount` to `z.number()` | Yes | The inventory reported `record_journal:postings[].amountMinor is z.number()` and the equivalent nested `supersede_journal` path. |

## Test improvements retained

No mutation passed against the original suite. Two tests were nevertheless
made stronger to satisfy the required security evidence:

1. The scope probe now supplies a valid payload for every registered
   read-write tool, including the nested `replacement` required by
   `supersede_journal`. It checks `handler` was not called before checking the
   returned error. The scope mutation was rerun afterward and failed on the
   handler-call assertion for all four tools.
2. The unbalanced-journal tests now assert the write log and stored-row
   invariants before asserting the structured error. After this change, the
   balance mutation failed directly on a non-empty write log rather than only
   on the error shape.

The registry-wide privilege and money checks already enumerated the actual
`MCP_TOOLS` registry and all nested input schemas, so they required no
hardcoded-list rewrite.

## Vulnerabilities found

None in the restored implementation. Every vulnerable mutation was
deliberate for this exercise and was reverted immediately after its failure
was captured. No broken implementation code is part of the final diff.

## Verification limits

The live MCP route suite has 13 tests and covers real cross-household journal
read access, cross-household posting, authentication, revocation, scope, and
unbalanced-write behavior. It does not independently drive a foreign
`supersede_journal` or `close_account` call through the HTTP route. Those
write paths were verified against the real Postgres repositories
(`supersedePosted` and `close`) and against the in-memory MCP handler world,
including real foreign IDs and zero-write assertions. No listed guarantee was
left without a failing mutation, but this remains a distinction between
repository-level and full-route coverage.

## Postgres and final test execution

The shell environment did not export `DATABASE_URL`, and Docker Compose's
Postgres container was not running. The integration suites call `loadEnv()`
or load the repository `.env`; that configured Postgres was reachable:

- `apps/web/tests/mcp-integration.test.ts`: 13 ran, 0 skipped.
- `packages/db/tests/journal-repo-extensions.integration.test.ts`: 15 ran,
  0 skipped.
- `packages/db/tests/account-repo.integration.test.ts`: 9 ran, 0 skipped.
- `packages/db/tests/token-repo.integration.test.ts`: 7 ran, 0 skipped.

The deliberate error-path test already mocks `console.error`, so the
correlation-ID log is suppressed without weakening the assertion. Final
verification gates:

- `pnpm --filter @stonks/web build` — passed; Next.js compiled all routes,
  including `/api/mcp/[transport]`.
- `pnpm -r typecheck` — passed for ledger, db, and web.
- `pnpm -r test` — passed: ledger 83 tests, db 53 tests, web 417 tests
  (553 total; 62 test files).
