import type { TokenRepo } from "@stonks/db";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@stonks/db";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * Token management logic behind the cookie-authenticated /api/tokens routes.
 * Tokens are created and revoked here only — deliberately never over MCP, so a
 * compromised agent cannot mint or rotate credentials. The plaintext is returned
 * exactly once by `createTokenHandler` and never appears in any list output.
 */

export type TokenHandlerCtx = {
  session: SessionPayload | null;
  repo: TokenRepo;
};

export type TokenHandlerResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string };

const UNAUTHORIZED: TokenHandlerResult = {
  ok: false,
  status: 401,
  error: "Unauthorized",
};

export async function listTokensHandler(
  ctx: TokenHandlerCtx,
): Promise<TokenHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  const rows = await ctx.repo.list(ctx.session.householdId);
  return {
    ok: true,
    status: 200,
    body: {
      tokens: rows.map((row) => ({
        id: row.id,
        name: row.name,
        scope: row.scope,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    },
  };
}

export async function createTokenHandler(
  body: unknown,
  ctx: TokenHandlerCtx,
): Promise<TokenHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Expected a JSON object body" };
  }

  const rawName = (body as Record<string, unknown>).name;
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return { ok: false, status: 400, error: "name must be a non-empty string" };
  }
  const name = rawName.trim();
  if (name.length > 100) {
    return { ok: false, status: 400, error: "name must be at most 100 characters" };
  }

  const rawScope = (body as Record<string, unknown>).scope;
  if (
    typeof rawScope !== "string" ||
    !(API_TOKEN_SCOPES as readonly string[]).includes(rawScope)
  ) {
    return {
      ok: false,
      status: 400,
      error: "scope must be 'read' or 'read_write'",
    };
  }
  const scope = rawScope as ApiTokenScope;

  const created = await ctx.repo.create(ctx.session.householdId, name, scope);

  // The only response that ever carries the plaintext.
  return {
    ok: true,
    status: 201,
    body: { id: created.id, token: created.token, name, scope },
  };
}

export async function revokeTokenHandler(
  id: unknown,
  ctx: TokenHandlerCtx,
): Promise<TokenHandlerResult> {
  if (!ctx.session) return UNAUTHORIZED;

  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, status: 400, error: "Token id required" };
  }

  // Household-scoped: a foreign id is indistinguishable from an unknown one.
  const revoked = await ctx.repo.revoke(ctx.session.householdId, id);
  if (!revoked) {
    return { ok: false, status: 404, error: "Token not found" };
  }

  return { ok: true, status: 200, body: { ok: true } };
}
