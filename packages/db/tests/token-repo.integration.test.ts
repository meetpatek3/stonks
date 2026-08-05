import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import { apiToken, currency, household } from "../src/schema/index.js";
import { createTokenRepo, hashToken } from "../src/repos/token-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("token repo integration", () => {
  const db = createDb(databaseUrl!);
  const repo = createTokenRepo(db);

  const householdId = crypto.randomUUID();
  const otherHouseholdId = crypto.randomUUID();

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();
    await db.insert(household).values([
      { id: householdId, reportingCurrency: "CAD" },
      { id: otherHouseholdId, reportingCurrency: "CAD" },
    ]);
  });

  afterAll(async () => {
    await db.delete(apiToken).where(eq(apiToken.householdId, householdId));
    await db.delete(apiToken).where(eq(apiToken.householdId, otherHouseholdId));
    await db.delete(household).where(eq(household.id, householdId));
    await db.delete(household).where(eq(household.id, otherHouseholdId));
  });

  it("creates a token whose verify resolves to the right household and scope", async () => {
    const created = await repo.create(householdId, "claude-agent", "read_write");
    expect(created.token.startsWith("stk_")).toBe(true);

    const verified = await repo.verify(created.token);
    expect(verified).toEqual({ householdId, scope: "read_write" });
  });

  it("stores only the SHA-256 hash, never the plaintext", async () => {
    const created = await repo.create(householdId, "hash-check", "read");

    const [row] = await db
      .select()
      .from(apiToken)
      .where(eq(apiToken.id, created.id));

    expect(row!.tokenHash).toBe(hashToken(created.token));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.tokenHash).not.toBe(created.token);
    // The plaintext appears nowhere on the stored row.
    expect(Object.values(row!)).not.toContain(created.token);
  });

  it("rejects an unknown token", async () => {
    expect(await repo.verify("stk_does-not-exist-anywhere")).toBeNull();
    expect(await repo.verify("garbage")).toBeNull();
  });

  it("rejects a revoked token on its next use", async () => {
    const created = await repo.create(householdId, "revoke-me", "read");
    expect(await repo.verify(created.token)).not.toBeNull();

    const revoked = await repo.revoke(householdId, created.id);
    expect(revoked).toBe(true);

    expect(await repo.verify(created.token)).toBeNull();
  });

  it("stamps last_used_at on successful verification", async () => {
    const created = await repo.create(householdId, "usage-stamp", "read");

    const before = await repo.list(householdId);
    expect(
      before.find((t) => t.id === created.id)!.lastUsedAt,
    ).toBeNull();

    await repo.verify(created.token);

    const after = await repo.list(householdId);
    expect(
      after.find((t) => t.id === created.id)!.lastUsedAt,
    ).toBeInstanceOf(Date);
  });

  it("cannot revoke another household's token", async () => {
    const created = await repo.create(householdId, "not-yours", "read_write");

    // Household B tries to revoke household A's token: nothing happens.
    const revoked = await repo.revoke(otherHouseholdId, created.id);
    expect(revoked).toBe(false);

    // The token still verifies — no cross-household mutation occurred.
    expect(await repo.verify(created.token)).toEqual({
      householdId,
      scope: "read_write",
    });
  });

  it("lists tokens scoped to their household, without hashes", async () => {
    const mine = await repo.create(householdId, "mine", "read");
    await repo.create(otherHouseholdId, "theirs", "read_write");

    const myList = await repo.list(householdId);
    const myIds = myList.map((t) => t.id);
    expect(myIds).toContain(mine.id);

    const theirList = await repo.list(otherHouseholdId);
    const theirIds = theirList.map((t) => t.id);
    expect(theirIds).not.toContain(mine.id);
    expect(theirList).toHaveLength(1);

    // No hash or plaintext leaks into the listing shape.
    for (const item of [...myList, ...theirList]) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "revokedAt",
        "scope",
      ]);
    }
  });
});
