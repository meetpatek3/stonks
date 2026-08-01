import { currency, eq, household, type Db } from "@stonks/db";
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

/** Creates the first household from AUTH_USERNAME / AUTH_PASSWORD when none exists. */
export async function ensureBootstrapUser(db: Db): Promise<void> {
  loadEnv();
  const existing = await db.select({ id: household.id }).from(household).limit(1);
  if (existing.length > 0) return;

  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "No household found. Set AUTH_USERNAME and AUTH_PASSWORD to bootstrap the first login.",
    );
  }

  await ensureBaseCurrencies(db);
  const passwordHash = await hashPassword(password);
  await db.insert(household).values({
    reportingCurrency: "CAD",
    authUsername: username,
    authPasswordHash: passwordHash,
  });
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
