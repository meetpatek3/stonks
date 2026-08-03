import {
  createAccountRepo,
  createJournalRepo,
  eq,
  household,
  type Db,
} from "@stonks/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";
import type { HouseholdInfoRepo, McpToolContext } from "./registrar";
import type { McpAuth } from "./auth";

/**
 * Production wiring for the tool context: drizzle-backed repos. Unit tests
 * never touch this module — they inject in-memory fakes straight into
 * `McpToolContext`.
 */
function createHouseholdInfoRepo(db: Db): HouseholdInfoRepo {
  return {
    async getReportingCurrency(householdId) {
      const [row] = await db
        .select({ reportingCurrency: household.reportingCurrency })
        .from(household)
        .where(eq(household.id, householdId))
        .limit(1);
      return row?.reportingCurrency ?? null;
    },
  };
}

/**
 * The single place where an authenticated identity becomes a tool context.
 * `householdId` comes from the token row only; every repo built here is
 * scoped by it downstream.
 */
export function createToolContext(db: Db, auth: McpAuth): McpToolContext {
  const journals = createJournalRepo(db);
  return {
    householdId: auth.householdId,
    scope: auth.scope,
    repos: {
      household: createHouseholdInfoRepo(db),
      portfolio: {
        // The same request-scoped read model the pages use; every figure in
        // it is derived by replay, never stored.
        getSnapshot: (householdId) => getPortfolioSnapshot(db, householdId),
      },
      accounts: createAccountRepo(db),
      // One journal repo instance backs both the narrowed read and write
      // interfaces; the repo has no update/delete path by design.
      journals,
      journalWrites: journals,
    },
  };
}
