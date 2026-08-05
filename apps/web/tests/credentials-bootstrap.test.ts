import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, currency, household } from "@stonks/db";
import { authenticate, ensureBootstrapUser } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { loadEnv } from "@/lib/env";

/**
 * Reproduces the production login 500: ensureBootstrapUser tried to attach
 * AUTH_USERNAME onto an unprovisioned household even though another household
 * already owned that username (unique constraint violation → every login fails).
 */
loadEnv();
const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("credentials bootstrap", () => {
  const db = createDb(databaseUrl!);
  const suffix = crypto.randomUUID().slice(0, 8);
  const provisionedId = crypto.randomUUID();
  const unprovisionedId = crypto.randomUUID();
  const username = `boot-user-${suffix}`;
  const password = `boot-pass-${suffix}`;

  beforeAll(async () => {
    process.env.AUTH_USERNAME = username;
    process.env.AUTH_PASSWORD = password;

    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();

    const passwordHash = await hashPassword(password);
    await db.insert(household).values([
      {
        id: provisionedId,
        reportingCurrency: "CAD",
        authUsername: username,
        authPasswordHash: passwordHash,
      },
      {
        id: unprovisionedId,
        reportingCurrency: "CAD",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(household).where(eq(household.id, provisionedId));
    await db.delete(household).where(eq(household.id, unprovisionedId));
  });

  it("skips attaching AUTH_* when a household is already provisioned", async () => {
    await expect(ensureBootstrapUser(db)).resolves.toBeUndefined();

    const rows = await db
      .select({
        id: household.id,
        authUsername: household.authUsername,
      })
      .from(household)
      .where(eq(household.id, unprovisionedId));

    expect(rows[0]?.authUsername).toBeNull();
  });

  it("still authenticates the provisioned household", async () => {
    const user = await authenticate(db, username, password);
    expect(user).toEqual({ username, householdId: provisionedId });
  });
});
