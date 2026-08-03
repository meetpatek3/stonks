import { eq, household, type Db } from "@stonks/db";
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
  return {
    householdId: auth.householdId,
    scope: auth.scope,
    repos: {
      household: createHouseholdInfoRepo(db),
    },
  };
}
