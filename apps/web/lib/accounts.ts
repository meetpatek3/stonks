import {
  accountTypeEnum,
  type AccountRepo,
  type AccountRecord,
} from "@stonks/db";
import type { AccountType } from "@stonks/ledger";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * Account management logic behind the cookie-authenticated /api/accounts routes.
 * Every account read and write is scoped to the session household. Balances are
 * read from the replay-derived portfolio model and are never accepted from a client.
 */

export interface AccountBalanceRepo {
  getSnapshot(householdId: string): Promise<{
    balances: Array<{ accountId: string; minor: string; currency: string }>;
  }>;
}

export type AccountHandlerCtx = {
  session: SessionPayload | null;
  repo: AccountRepo;
  portfolio: AccountBalanceRepo;
};

export type AccountHandlerResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string };

const UNAUTHORIZED: AccountHandlerResult = {
  ok: false,
  status: 401,
  error: "Unauthorized",
};

function accountToWire(record: AccountRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    currency: record.currency,
    minorUnits: record.minorUnits,
    taxTreatment: record.taxTreatment,
    closedAt: record.closedAt,
  };
}

export async function listAccountsHandler(
  includeClosed: boolean,
  ctx: AccountHandlerCtx,
): Promise<AccountHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  const [accounts, currencies] = await Promise.all([
    ctx.repo.list(ctx.session.householdId, { includeClosed }),
    ctx.repo.listCurrencies(),
  ]);
  return {
    ok: true,
    status: 200,
    body: {
      accounts: accounts.map(accountToWire),
      currencies,
    },
  };
}

export async function createAccountHandler(
  body: unknown,
  ctx: AccountHandlerCtx,
): Promise<AccountHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }

  const input = body as Record<string, unknown>;
  const rawName = input.name;
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return { ok: false, status: 400, error: "name must be a non-empty string" };
  }
  const name = rawName.trim();

  const rawType = input.type;
  if (
    typeof rawType !== "string" ||
    !(accountTypeEnum.enumValues as readonly string[]).includes(rawType)
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "type must be one of INVESTMENT, CREDIT_FACILITY, RECEIVABLE, CASH, or EXTERNAL",
    };
  }
  const type = rawType as AccountType;

  const rawCurrency = input.currency;
  if (typeof rawCurrency !== "string" || rawCurrency.length === 0) {
    return { ok: false, status: 400, error: "currency must be a known currency code" };
  }
  const knownCurrency = await ctx.repo.getCurrency(rawCurrency);
  if (knownCurrency === null) {
    return {
      ok: false,
      status: 400,
      error: `Unknown currency "${rawCurrency}" — the currency table has no such code.`,
    };
  }

  const rawTaxTreatment = input.taxTreatment;
  if (
    rawTaxTreatment !== undefined &&
    (typeof rawTaxTreatment !== "string" || rawTaxTreatment.trim().length === 0)
  ) {
    return {
      ok: false,
      status: 400,
      error: "taxTreatment must be a non-empty string when provided",
    };
  }
  const taxTreatment =
    typeof rawTaxTreatment === "string" ? rawTaxTreatment.trim() : undefined;

  const created = await ctx.repo.create(ctx.session.householdId, {
    name,
    type,
    currency: rawCurrency,
    ...(taxTreatment === undefined ? {} : { taxTreatment }),
  });

  return {
    ok: true,
    status: 201,
    body: { account: accountToWire(created) },
  };
}

export async function closeAccountHandler(
  id: unknown,
  ctx: AccountHandlerCtx,
): Promise<AccountHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, status: 400, error: "Account id required" };
  }

  // Household-scoped: a foreign id is indistinguishable from an unknown one.
  const account = await ctx.repo.getById(ctx.session.householdId, id);
  if (account === null) {
    return { ok: false, status: 404, error: "Account not found" };
  }

  const snapshot = await ctx.portfolio.getSnapshot(ctx.session.householdId);
  const replayBalance = snapshot.balances.find(
    (balance) => balance.accountId === account.id,
  );
  // No replay row means no postings ever touched the account: exactly zero.
  const balanceMinor = replayBalance?.minor ?? "0";
  if (balanceMinor !== "0") {
    return {
      ok: false,
      status: 409,
      error:
        `Account "${account.name}" (${account.id}) has a replay balance of ${balanceMinor} ` +
        `${replayBalance?.currency ?? account.currency} minor units; only a zero-balance account can be closed.`,
    };
  }

  const closed = await ctx.repo.close(ctx.session.householdId, account.id);
  if (closed === null) {
    return { ok: false, status: 404, error: "Account not found" };
  }

  return {
    ok: true,
    status: 200,
    body: { account: accountToWire(closed) },
  };
}
