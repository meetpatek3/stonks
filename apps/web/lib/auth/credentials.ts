import {
  and,
  currency,
  eq,
  household,
  isNotNull,
  isNull,
  or,
  type Db,
} from "@stonks/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loadEnv } from "@/lib/env";

export type AuthUser = {
  username: string;
  householdId: string;
};

async function ensureBaseCurrencies(db: Db): Promise<void> {
  await db
    .insert(currency)
    .values([
      { code: "CAD", minorUnits: 2, name: "Canadian Dollar" },
      { code: "USD", minorUnits: 2, name: "US Dollar" },
    ])
    .onConflictDoNothing();
}

function bootstrapCredentials(): { username: string; password: string } {
  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Set AUTH_USERNAME and AUTH_PASSWORD to bootstrap household login credentials.",
    );
  }
  return { username, password };
}

/**
 * Ensures a household can log in:
 * - empty DB → create first household from AUTH_* env
 * - existing household(s) with null auth columns and none yet provisioned
   (post-0003 upgrade) → attach AUTH_* once to the first unprovisioned row
 *
 * If any household is already provisioned, leave others alone. Re-attaching
 * AUTH_* onto a second row races the unique username constraint and takes
 * down every login attempt.
 */
export async function ensureBootstrapUser(db: Db): Promise<void> {
  loadEnv();

  const anyHousehold = await db.select({ id: household.id }).from(household).limit(1);
  if (anyHousehold.length === 0) {
    const { username, password } = bootstrapCredentials();
    await ensureBaseCurrencies(db);
    const passwordHash = await hashPassword(password);
    await db.insert(household).values({
      reportingCurrency: "CAD",
      authUsername: username,
      authPasswordHash: passwordHash,
    });
    return;
  }

  const alreadyProvisioned = await db
    .select({ id: household.id })
    .from(household)
    .where(and(isNotNull(household.authUsername), isNotNull(household.authPasswordHash)))
    .limit(1)
    .then((rows) => rows[0]);

  if (alreadyProvisioned) return;

  const unprovisioned = await db
    .select({ id: household.id })
    .from(household)
    .where(or(isNull(household.authUsername), isNull(household.authPasswordHash)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!unprovisioned) return;

  const { username, password } = bootstrapCredentials();
  const passwordHash = await hashPassword(password);
  await db
    .update(household)
    .set({ authUsername: username, authPasswordHash: passwordHash })
    .where(eq(household.id, unprovisioned.id));
}

export async function authenticate(
  db: Db,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  await ensureBootstrapUser(db);

  const row = await db
    .select()
    .from(household)
    .where(eq(household.authUsername, username))
    .limit(1)
    .then((rows) => rows[0]);

  if (!row?.authPasswordHash) return null;

  const ok = await verifyPassword(password, row.authPasswordHash);
  if (!ok) return null;

  return { username: row.authUsername!, householdId: row.id };
}
