import { and, asc, eq, isNull } from "drizzle-orm";
import { ValidationError, type AccountType } from "@stonks/ledger";
import type { Db } from "../client.js";
import { account, currency } from "../schema/index.js";

/**
 * Household-scoped access over the `account` table. Every query filters by
 * `household_id` first, so a foreign id is indistinguishable from an unknown
 * one — cross-household access is a security defect, and there is no code
 * path here that can produce it.
 *
 * Writes are additive or state-marking only: `create` inserts a new account,
 * `close` stamps `closed_at` (idempotently). There is no update or delete of
 * account history.
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
  /** Currency reference data is global, so account forms need no household context. */
  listCurrencies(): Promise<CurrencyRecord[]>;
  /** A known currency by ISO code, or null — the FK source for account currencies. */
  getCurrency(code: string): Promise<CurrencyRecord | null>;
  /**
   * Insert a new account with a generated id. The currency must be a known
   * `currency` row (else `ValidationError` code CURRENCY) — the same check
   * the FK enforces, surfaced as a domain error instead of a driver error.
   */
  create(householdId: string, input: CreateAccountInput): Promise<AccountRecord>;
  /**
   * Stamp `closed_at` on an account of this household, idempotently (an
   * already-closed account keeps its original timestamp). Returns null for a
   * foreign or unknown id. The zero-balance rule is the caller's job — the
   * repo cannot see replay balances.
   */
  close(householdId: string, id: string): Promise<AccountRecord | null>;
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency: string;
  taxTreatment?: string | null;
}

export interface CurrencyRecord {
  code: string;
  minorUnits: number;
  name: string;
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
  async function getById(householdId: string, id: string): Promise<AccountRecord | null> {
    const [row] = await db
      .select(selection)
      .from(account)
      .innerJoin(currency, eq(account.currency, currency.code))
      .where(and(eq(account.householdId, householdId), eq(account.id, id)))
      .limit(1);
    return row === undefined ? null : toAccountRecord(row);
  }

  async function getCurrency(code: string): Promise<CurrencyRecord | null> {
    const [row] = await db.select().from(currency).where(eq(currency.code, code)).limit(1);
    return row === undefined ? null : row;
  }

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

    getById,

    async listCurrencies() {
      return db.select().from(currency).orderBy(asc(currency.code));
    },

    getCurrency,

    async create(householdId, input) {
      const known = await getCurrency(input.currency);
      if (known === null) {
        throw new ValidationError(
          `Unknown currency: ${input.currency}`,
          "CURRENCY",
          [input.currency],
        );
      }
      const id = crypto.randomUUID();
      await db.insert(account).values({
        id,
        householdId,
        type: input.type,
        currency: input.currency,
        name: input.name,
        taxTreatment: input.taxTreatment ?? null,
      });
      return {
        id,
        name: input.name,
        type: input.type,
        currency: input.currency,
        minorUnits: known.minorUnits,
        taxTreatment: input.taxTreatment ?? null,
        closedAt: null,
      };
    },

    async close(householdId, id) {
      await db
        .update(account)
        .set({ closedAt: new Date() })
        .where(
          and(
            eq(account.householdId, householdId),
            eq(account.id, id),
            isNull(account.closedAt),
          ),
        );
      return getById(householdId, id);
    },
  };
}
