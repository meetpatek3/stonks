import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { apiToken, type ApiTokenScope } from "../schema/index.js";

/**
 * `stk_` + 32 random bytes as base64url (43 chars). The plaintext is returned to the
 * caller exactly once; only `hashToken(plaintext)` is ever persisted.
 */
export function generateToken(): string {
  return `stk_${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex of the plaintext. Lookup is by hash equality — the hash is unguessable. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export type VerifiedToken = { householdId: string; scope: ApiTokenScope };

/** List shape deliberately excludes `tokenHash` — a listing must never leak a hash. */
export type ApiTokenSummary = {
  id: string;
  name: string;
  scope: ApiTokenScope;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export interface TokenRepo {
  /** Returns the plaintext exactly once alongside the row id; only the hash is stored. */
  create(
    householdId: string,
    name: string,
    scope: ApiTokenScope,
  ): Promise<{ id: string; token: string }>;
  /**
   * Resolves a bearer token to its household and scope, stamping `last_used_at`.
   * Unknown or revoked tokens resolve to null — revocation is effective immediately.
   */
  verify(plaintext: string): Promise<VerifiedToken | null>;
  /**
   * Revokes immediately, scoped by household: a foreign id is a no-op returning false,
   * so one household can never revoke another's token.
   */
  revoke(householdId: string, id: string): Promise<boolean>;
  /** Every token (including revoked) for the household, newest first, hash-free. */
  list(householdId: string): Promise<ApiTokenSummary[]>;
}

export function createTokenRepo(db: Db): TokenRepo {
  return {
    async create(householdId, name, scope) {
      const token = generateToken();
      const [row] = await db
        .insert(apiToken)
        .values({ householdId, name, scope, tokenHash: hashToken(token) })
        .returning({ id: apiToken.id });
      return { id: row!.id, token };
    },

    async verify(plaintext) {
      const [row] = await db
        .select({
          id: apiToken.id,
          householdId: apiToken.householdId,
          scope: apiToken.scope,
        })
        .from(apiToken)
        .where(and(eq(apiToken.tokenHash, hashToken(plaintext)), isNull(apiToken.revokedAt)))
        .limit(1);

      if (!row) return null;

      await db
        .update(apiToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiToken.id, row.id));

      return { householdId: row.householdId, scope: row.scope };
    },

    async revoke(householdId, id) {
      const updated = await db
        .update(apiToken)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiToken.id, id),
            eq(apiToken.householdId, householdId),
            isNull(apiToken.revokedAt),
          ),
        )
        .returning({ id: apiToken.id });
      return updated.length > 0;
    },

    async list(householdId) {
      const rows = await db
        .select({
          id: apiToken.id,
          name: apiToken.name,
          scope: apiToken.scope,
          createdAt: apiToken.createdAt,
          lastUsedAt: apiToken.lastUsedAt,
          revokedAt: apiToken.revokedAt,
        })
        .from(apiToken)
        .where(eq(apiToken.householdId, householdId))
        .orderBy(desc(apiToken.createdAt), desc(apiToken.id));
      return rows;
    },
  };
}
