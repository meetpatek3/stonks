import { describe, expect, it, vi } from "vitest";
import type { AccountRecord, AccountRepo } from "@stonks/db";
import {
  closeAccountHandler,
  createAccountHandler,
  listAccountsHandler,
  type AccountBalanceRepo,
  type AccountHandlerCtx,
} from "@/lib/accounts";

const HOUSEHOLD = "hh-a";
const OTHER_HOUSEHOLD = "hh-b";

const session = { username: "meet", householdId: HOUSEHOLD };

const CURRENCIES = [
  { code: "CAD", minorUnits: 2, name: "Canadian Dollar" },
  { code: "USD", minorUnits: 2, name: "US Dollar" },
];

type StoredRow = AccountRecord & { householdId: string };

/**
 * In-memory fake enforcing the same household-scoping contract as the real repo:
 * reads and closes hide foreign ids, and list only returns the caller's household.
 */
function makeFakeRepo() {
  const rows = new Map<string, StoredRow>();
  let counter = 0;

  const repo: AccountRepo = {
    async list(householdId, options) {
      return [...rows.values()]
        .filter(
          (row) =>
            row.householdId === householdId &&
            (options?.includeClosed || row.closedAt === null),
        )
        .map(({ householdId: _householdId, ...row }) => row);
    },
    async getById(householdId, id) {
      const row = rows.get(id);
      if (!row || row.householdId !== householdId) return null;
      const { householdId: _householdId, ...record } = row;
      return record;
    },
    async listCurrencies() {
      return CURRENCIES;
    },
    async getCurrency(code) {
      return CURRENCIES.find((currency) => currency.code === code) ?? null;
    },
    async create(householdId, input) {
      counter += 1;
      const knownCurrency = CURRENCIES.find(
        (currency) => currency.code === input.currency,
      );
      if (!knownCurrency) throw new Error("currency should have been validated");
      const row: StoredRow = {
        id: `acct-${counter}`,
        householdId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        minorUnits: knownCurrency.minorUnits,
        taxTreatment: input.taxTreatment ?? null,
        closedAt: null,
      };
      rows.set(row.id, row);
      const { householdId: _householdId, ...record } = row;
      return record;
    },
    async close(householdId, id) {
      const row = rows.get(id);
      if (!row || row.householdId !== householdId) return null;
      row.closedAt ??= "2026-08-05T14:00:00.000Z";
      const { householdId: _householdId, ...record } = row;
      return record;
    },
  };

  function seed(householdId: string, row: AccountRecord) {
    rows.set(row.id, { ...row, householdId });
  }

  return { repo, rows, seed };
}

function makePortfolio(
  balances: Array<{ accountId: string; minor: string; currency: string }> = [],
): AccountBalanceRepo {
  return {
    async getSnapshot() {
      return { balances };
    },
  };
}

function ctxWith(
  repo: AccountRepo,
  overrides: Partial<AccountHandlerCtx> = {},
): AccountHandlerCtx {
  return { session, repo, portfolio: makePortfolio(), ...overrides };
}

const account = (
  id: string,
  name: string,
  overrides: Partial<AccountRecord> = {},
): AccountRecord => ({
  id,
  name,
  type: "CASH",
  currency: "CAD",
  minorUnits: 2,
  taxTreatment: null,
  closedAt: null,
  ...overrides,
});

describe("listAccountsHandler", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const { repo } = makeFakeRepo();
    const result = await listAccountsHandler(
      false,
      ctxWith(repo, { session: null }),
    );
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("lists household accounts and currencies, optionally including closed accounts", async () => {
    const { repo, seed } = makeFakeRepo();
    seed(HOUSEHOLD, account("open", "Chequing"));
    seed(
      HOUSEHOLD,
      account("closed", "Old account", {
        closedAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    seed(OTHER_HOUSEHOLD, account("foreign", "Not mine"));

    const openResult = await listAccountsHandler(false, ctxWith(repo));
    expect(openResult).toEqual({
      ok: true,
      status: 200,
      body: { accounts: [account("open", "Chequing")], currencies: CURRENCIES },
    });

    const allResult = await listAccountsHandler(true, ctxWith(repo));
    expect(allResult.ok).toBe(true);
    if (!allResult.ok) return;
    const body = allResult.body as { accounts: AccountRecord[] };
    expect(body.accounts.map((row) => row.id)).toEqual(["open", "closed"]);
  });
});

describe("createAccountHandler", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const { repo } = makeFakeRepo();
    const result = await createAccountHandler(
      { name: "Chequing", type: "CASH", currency: "CAD" },
      ctxWith(repo, { session: null }),
    );
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("creates a trimmed account in the session household and returns 201", async () => {
    const { repo } = makeFakeRepo();
    const createSpy = vi.spyOn(repo, "create");

    const result = await createAccountHandler(
      {
        name: "  USD Brokerage  ",
        type: "INVESTMENT",
        currency: "USD",
        taxTreatment: "  TFSA  ",
      },
      ctxWith(repo),
    );

    expect(result).toEqual({
      ok: true,
      status: 201,
      body: {
        account: {
          id: "acct-1",
          name: "USD Brokerage",
          type: "INVESTMENT",
          currency: "USD",
          minorUnits: 2,
          taxTreatment: "TFSA",
          closedAt: null,
        },
      },
    });
    expect(createSpy).toHaveBeenCalledWith(HOUSEHOLD, {
      name: "USD Brokerage",
      type: "INVESTMENT",
      currency: "USD",
      taxTreatment: "TFSA",
    });
  });

  it("rejects a whitespace-only name with 400", async () => {
    const { repo } = makeFakeRepo();
    const result = await createAccountHandler(
      { name: "   ", type: "CASH", currency: "CAD" },
      ctxWith(repo),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/name/i);
  });

  it("rejects a bad account type with 400", async () => {
    const { repo } = makeFakeRepo();
    const result = await createAccountHandler(
      { name: "Savings", type: "SAVINGS", currency: "CAD" },
      ctxWith(repo),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/type/i);
  });

  it("rejects an unknown currency with 400 instead of calling create", async () => {
    const { repo } = makeFakeRepo();
    const createSpy = vi.spyOn(repo, "create");
    const result = await createAccountHandler(
      { name: "Euro cash", type: "CASH", currency: "EUR" },
      ctxWith(repo),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toContain("EUR");
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("closeAccountHandler", () => {
  it("refuses a non-zero replay balance with 409 and names the balance", async () => {
    const { repo, seed } = makeFakeRepo();
    seed(HOUSEHOLD, account("cash", "Chequing"));
    const closeSpy = vi.spyOn(repo, "close");

    const result = await closeAccountHandler(
      "cash",
      ctxWith(repo, {
        portfolio: makePortfolio([
          { accountId: "cash", minor: "150000", currency: "CAD" },
        ]),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toContain("150000 CAD minor units");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign or unknown id without loading replay", async () => {
    const { repo, seed } = makeFakeRepo();
    seed(OTHER_HOUSEHOLD, account("foreign", "Not mine"));
    const portfolio = makePortfolio();
    const snapshotSpy = vi.spyOn(portfolio, "getSnapshot");

    for (const id of ["foreign", "missing"]) {
      const result = await closeAccountHandler(
        id,
        ctxWith(repo, { portfolio }),
      );
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: "Account not found",
      });
    }
    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  it("closes a zero-balance account successfully", async () => {
    const { repo, seed, rows } = makeFakeRepo();
    seed(HOUSEHOLD, account("cash", "Chequing"));

    const result = await closeAccountHandler("cash", ctxWith(repo));

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        account: account("cash", "Chequing", {
          closedAt: "2026-08-05T14:00:00.000Z",
        }),
      },
    });
    expect(rows.get("cash")?.closedAt).toBe("2026-08-05T14:00:00.000Z");
  });
});
