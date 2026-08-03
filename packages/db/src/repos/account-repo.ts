import { and, asc, eq, isNull } from "drizzle-orm";
import type { AccountType } from "@stonks/ledger";
import type { Db } from "../client.js";
import { account, currency } from "../schema/index.js";

/**
 * Household-scoped reads over the `account` table. Every query filters by
 * `household_id` first, so a foreign id is indistinguishable from an unknown
 * one — cross-household access is a security defect, and there is no code
 * path here that can produce it.
 *
 * This is the read half of the account repository; the write methods
 * (`create`, `close`) arrive with the account-management tools.
 */

export interface AccountRecord {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Currency minor-unit scale (0 for JPY, 2 for CAD/USD, …). */
  minorUnits: number;
  taxTreatment: string | null;
  /** ISO timestamp, or null while the account is open. */
  closedAt: string | null;
}

export interface AccountRepo {
  /** Open accounts by default; closed ones only when explicitly asked for. */
  list(householdId: string, options?: { includeClosed?: boolean }): Promise<AccountRecord[]>;
  /** Single fetch, household-scoped: a foreign id returns null. */
  getById(householdId: string, id: string): Promise<AccountRecord | null>;
}

/** The joined row shape the queries below select. */
export type AccountRow = typeof account.$inferSelect & { minorUnits: number };

/** Row → record. Pure, so it is unit-tested without a database. */
export function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    minorUnits: row.minorUnits,
    taxTreatment: row.taxTreatment,
    closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  };
}

const selection = {
  id: account.id,
  householdId: account.householdId,
  type: account.type,
  currency: account.currency,
  taxTreatment: account.taxTreatment,
  name: account.name,
  contributionPolicyId: account.contributionPolicyId,
  closedAt: account.closedAt,
  minorUnits: currency.minorUnits,
};

export function createAccountRepo(db: Db): AccountRepo {
  return {
    async list(householdId, options) {
      const conditions = [eq(account.householdId, householdId)];
      if (!options?.includeClosed) {
        conditions.push(isNull(account.closedAt));
      }
      const rows = await db
        .select(selection)
        .from(account)
        .innerJoin(currency, eq(account.currency, currency.code))
        .where(and(...conditions))
        .orderBy(asc(account.name));
      return rows.map(toAccountRecord);
    },

    async getById(householdId, id) {
      const [row] = await db
        .select(selection)
        .from(account)
        .innerJoin(currency, eq(account.currency, currency.code))
        .where(and(eq(account.householdId, householdId), eq(account.id, id)))
        .limit(1);
      return row === undefined ? null : toAccountRecord(row);
    },
  };
}
