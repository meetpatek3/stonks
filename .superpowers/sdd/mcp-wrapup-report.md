# MCP wrap-up report

Date: 2026-08-05

## Fixed

1. Confirmed the `mcp-handler` endpoint derivation: `basePath: "/api/mcp"` serves
   the streamable HTTP endpoint at `/api/mcp/mcp`. The Settings copy, design spec,
   companion plan smoke-test command, route constant, and integration request now
   use that endpoint. The live route integration test verified initialization and
   tool calls at this URL.
2. Registered `stonks://reference/journal-types` as a static markdown MCP resource.
   It documents journal types, signed debit-positive postings, string wire formats,
   posting shape, facility-use coverage, balanced deposit and buy examples, and
   immutable corrections.
3. Added `PortfolioSnapshot.valuation` to `get_portfolio_overview` as a direct
   projection. Null values, `uncertaintyReasons`, `staleReasons`, and `pricedAsOf`
   remain unchanged.
4. Added each facility's `interestOverTime` to `get_borrowing_summary`. Monthly
   actual values are labelled `ACTUAL`; modelled values are labelled `MODELLED`
   and retain `modelledIsEstimate`.
5. Removed `CORPORATE_ACTION` from the writable journal type schema. The tool
   description and structured `INVALID_INPUT` response explicitly say that its
   payload is not yet supported. Journal history can still read that type.

To satisfy the required full-suite gate, the existing tax-tool output contract was
also completed by passing through `reportingCurrency` and `reportingMinorUnits`;
the test fixture now explicitly supplies the known CAD scale. No tax calculation
was added.

## TDD evidence

The first focused run was red for the intended missing behavior: the new endpoint
and resource modules were absent, valuation and monthly interest output were
`undefined`, and `CORPORATE_ACTION` was still advertised.

After implementation, the focused MCP tests passed. The final verification passed:

- `pnpm --filter @stonks/web build`
- `pnpm -r typecheck`
- `pnpm -r test` — ledger 83, database 54, web 444 tests passed

## Files changed

- MCP route and endpoint constants:
  `apps/web/app/api/mcp/[transport]/route.ts`,
  `apps/web/lib/mcp/endpoint.ts`
- Reference resource:
  `apps/web/lib/mcp/resources.ts`
- MCP tools:
  `apps/web/lib/mcp/tools/{borrowing,journals-read,journals-write,portfolio,tax}.ts`
- Settings and tests:
  `apps/web/components/settings-screen.tsx`,
  `apps/web/tests/{mcp-borrowing-tools,mcp-endpoint,mcp-integration,mcp-journal-write-tools,mcp-portfolio-tools,mcp-resources,mcp-tax-tools}.test.ts`
- Documentation:
  `docs/superpowers/plans/2026-08-02-mcp-server-plan.md`,
  `docs/superpowers/specs/2026-08-02-mcp-server-design.md`

## Deliberately left undone

- MCP Tasks 11 and 12, including import/reconciliation tools, facility-admin
  tools, additional resources, and prompts.
- Corporate-action persistence or posting support.
- UI changes other than the Settings connection copy.
- `apps/web/app/globals.css` changes.
