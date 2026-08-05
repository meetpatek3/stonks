import { describe, expect, it, vi } from "vitest";
import type { ApiTokenSummary, TokenRepo } from "@stonks/db";
import {
  createTokenHandler,
  listTokensHandler,
  revokeTokenHandler,
  type TokenHandlerCtx,
} from "@/lib/tokens";

const HOUSEHOLD = "hh-a";
const OTHER_HOUSEHOLD = "hh-b";

const session = { username: "meet", householdId: HOUSEHOLD };

type StoredRow = ApiTokenSummary & { householdId: string; plaintext: string };

/**
 * In-memory fake enforcing the same household-scoping contract as the real repo:
 * revoke is a no-op for foreign ids, and list only returns the caller's household.
 */
function makeFakeRepo() {
  const rows = new Map<string, StoredRow>();
  let counter = 0;

  const repo: TokenRepo = {
    async create(householdId, name, scope) {
      counter += 1;
      const id = `tok-${counter}`;
      const plaintext = `stk_fake-${counter}`;
      rows.set(id, {
        id,
        householdId,
        name,
        scope,
        plaintext,
        createdAt: new Date("2026-08-03T14:00:00.000Z"),
        lastUsedAt: null,
        revokedAt: null,
      });
      return { id, token: plaintext };
    },
    async verify() {
      throw new Error("verify is not used by the management API");
    },
    async revoke(householdId, id) {
      const row = rows.get(id);
      if (!row || row.householdId !== householdId || row.revokedAt) return false;
      row.revokedAt = new Date("2026-08-03T15:00:00.000Z");
      return true;
    },
    async list(householdId) {
      return [...rows.values()]
        .filter((r) => r.householdId === householdId)
        .map(({ id, name, scope, createdAt, lastUsedAt, revokedAt }) => ({
          id,
          name,
          scope,
          createdAt,
          lastUsedAt,
          revokedAt,
        }));
    },
  };

  return { repo, rows };
}

function ctxWith(
  repo: TokenRepo,
  overrides: Partial<TokenHandlerCtx> = {},
): TokenHandlerCtx {
  return { session, repo, ...overrides };
}

describe("listTokensHandler", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const { repo } = makeFakeRepo();
    const result = await listTokensHandler(ctxWith(repo, { session: null }));
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("lists the session household's tokens with no hash or plaintext", async () => {
    const { repo } = makeFakeRepo();
    await repo.create(HOUSEHOLD, "claude", "read_write");
    await repo.create(HOUSEHOLD, "reader", "read");
    await repo.create(OTHER_HOUSEHOLD, "not-mine", "read");

    const result = await listTokensHandler(ctxWith(repo));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);

    const body = result.body as { tokens: Array<Record<string, unknown>> };
    expect(body.tokens).toHaveLength(2);
    expect(body.tokens.map((t) => t.name).sort()).toEqual(["claude", "reader"]);

    for (const item of body.tokens) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "revokedAt",
        "scope",
      ]);
      expect(item.createdAt).toBe("2026-08-03T14:00:00.000Z");
    }
  });
});

describe("createTokenHandler", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const { repo } = makeFakeRepo();
    const result = await createTokenHandler(
      { name: "x", scope: "read" },
      ctxWith(repo, { session: null }),
    );
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("returns the plaintext exactly once at creation", async () => {
    const { repo } = makeFakeRepo();
    const createSpy = vi.spyOn(repo, "create");

    const result = await createTokenHandler(
      { name: "claude", scope: "read_write" },
      ctxWith(repo),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(201);

    const body = result.body as Record<string, unknown>;
    expect(body).toEqual({
      id: "tok-1",
      token: "stk_fake-1",
      name: "claude",
      scope: "read_write",
    });

    // Scoped to the session household.
    expect(createSpy).toHaveBeenCalledWith(HOUSEHOLD, "claude", "read_write");

    // The plaintext never appears in a subsequent listing.
    const list = await listTokensHandler(ctxWith(repo));
    if (!list.ok) throw new Error("list failed");
    expect(JSON.stringify(list.body)).not.toContain("stk_fake-1");
  });

  it("rejects a scope outside read/read_write with 400", async () => {
    const { repo } = makeFakeRepo();

    const result = await createTokenHandler(
      { name: "admin", scope: "admin" },
      ctxWith(repo),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/scope/i);
  });

  it("rejects a missing or empty name with 400", async () => {
    const { repo } = makeFakeRepo();

    for (const body of [
      { scope: "read" },
      { name: "", scope: "read" },
      { name: "   ", scope: "read" },
      { name: 42, scope: "read" },
    ]) {
      const result = await createTokenHandler(body, ctxWith(repo));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/name/i);
    }
  });

  it("rejects a non-object body with 400", async () => {
    const { repo } = makeFakeRepo();
    const result = await createTokenHandler("nope", ctxWith(repo));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});

describe("revokeTokenHandler", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const { repo } = makeFakeRepo();
    const result = await revokeTokenHandler("tok-1", ctxWith(repo, { session: null }));
    expect(result).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("revokes the session household's own token", async () => {
    const { repo, rows } = makeFakeRepo();
    const created = await repo.create(HOUSEHOLD, "claude", "read_write");

    const result = await revokeTokenHandler(created.id, ctxWith(repo));

    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } });
    expect(rows.get(created.id)!.revokedAt).toBeInstanceOf(Date);
  });

  it("returns 404 for another household's token id without revoking it", async () => {
    const { repo, rows } = makeFakeRepo();
    const foreign = await repo.create(OTHER_HOUSEHOLD, "theirs", "read");

    const revokeSpy = vi.spyOn(repo, "revoke");
    const result = await revokeTokenHandler(foreign.id, ctxWith(repo));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);

    // The lookup was scoped to the session household, and the row is untouched.
    expect(revokeSpy).toHaveBeenCalledWith(HOUSEHOLD, foreign.id);
    expect(rows.get(foreign.id)!.revokedAt).toBeNull();
  });

  it("returns 404 for an unknown id", async () => {
    const { repo } = makeFakeRepo();
    const result = await revokeTokenHandler("tok-999", ctxWith(repo));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
