import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import { account, currency, household } from "../src/schema/index.js";
import { createAccountRepo } from "../src/repos/account-repo.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

/**
 * Account repo reads against real Postgres: household scoping (a foreign id
 * is indistinguishable from an unknown one) and the includeClosed filter.
 */
describeIfDb("account repo (integration)", () => {
  const db = createDb(databaseUrl!);
  const repo = createAccountRepo(db);

  const suffix = crypto.randomUUID().slice(0, 8);
  const householdA = crypto.randomUUID();
  const householdB = crypto.randomUUID();

  const cashA = `acct-cash-a-${suffix}`;
  const closedA = `acct-closed-a-${suffix}`;
  const acctB = `acct-b-${suffix}`;

  beforeAll(async () => {
    await db
      .insert(currency)
      .values({ code: "CAD", minorUnits: 2, name: "Canadian Dollar" })
      .onConflictDoNothing();
    await db.insert(household).values([
      { id: householdA, reportingCurrency: "CAD" },
      { id: householdB, reportingCurrency: "CAD" },
    ]);
    await db.insert(account).values([
      {
        id: cashA,
        householdId: householdA,
        type: "CASH",
        currency: "CAD",
        name: "Chequing",
        taxTreatment: null,
      },
      {
        id: closedA,
        householdId: householdA,
        type: "INVESTMENT",
        currency: "CAD",
        name: "Old brokerage",
        taxTreatment: "TFSA",
        closedAt: new Date("2025-01-15T00:00:00.000Z"),
      },
      {
        id: acctB,
        householdId: householdB,
        type: "CASH",
        currency: "CAD",
        name: "B chequing",
        taxTreatment: null,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(account).where(eq(account.householdId, householdA));
    await db.delete(account).where(eq(account.householdId, householdB));
    await db.delete(household).where(eq(household.id, householdA));
    await db.delete(household).where(eq(household.id, householdB));
  });

  it("lists only the household's open accounts by default", async () => {
    const rows = await repo.list(householdA);
    expect(rows.map((row) => row.id)).toEqual([cashA]);
    expect(rows[0]).toMatchObject({
      name: "Chequing",
      type: "CASH",
      currency: "CAD",
      minorUnits: 2,
      taxTreatment: null,
      closedAt: null,
    });
  });

  it("includes closed accounts — with their closedAt — only when asked", async () => {
    const rows = await repo.list(householdA, { includeClosed: true });
    expect(rows.map((row) => row.id).sort()).toEqual([cashA, closedA].sort());
    const closed = rows.find((row) => row.id === closedA);
    expect(closed?.closedAt).toBe("2025-01-15T00:00:00.000Z");
    expect(closed?.taxTreatment).toBe("TFSA");
  });

  it("never returns another household's account, in list or by id", async () => {
    const rows = await repo.list(householdA, { includeClosed: true });
    expect(rows.some((row) => row.id === acctB)).toBe(false);
    expect(await repo.getById(householdA, acctB)).toBeNull();
  });

  it("fetches one account by id within the household", async () => {
    const row = await repo.getById(householdA, cashA);
    expect(row).toMatchObject({ id: cashA, name: "Chequing" });
  });
});
