import type { ApiTokenScope } from "@stonks/db";

/**
 * MCP bearer authentication (design spec §3, §12.1).
 *
 * Personal access tokens only — no OAuth layer, no discovery endpoints.
 * A request presents `Authorization: Bearer <token>`; the token resolves to
 * exactly one `{ householdId, scope }` via the token repo (hash lookup,
 * revoked rows rejected there). Everything downstream takes that householdId.
 *
 * This module is deliberately the single seam between transport auth and the
 * tool layer, so a future OAuth layer could slot in without touching any tool.
 *
 * Security rules honoured here:
 * - the plaintext token is never logged and never read from a URL;
 * - a malformed header is rejected without touching the database.
 */

export type McpAuth = {
  householdId: string;
  scope: ApiTokenScope;
};

export type TokenVerifier = {
  verify(plaintext: string): Promise<McpAuth | null>;
};

const BEARER = /^Bearer[ \t]+(\S+)$/i;

/**
 * Resolve the Authorization header to an auth context, or null when the
 * request must be rejected with HTTP 401 (missing/malformed header, unknown
 * or revoked token).
 */
export async function authenticateMcpRequest(
  authorization: string | null,
  tokenRepo: TokenVerifier,
): Promise<McpAuth | null> {
  if (!authorization) return null;

  const match = BEARER.exec(authorization.trim());
  if (!match) return null;

  const plaintext = match[1]!;
  return tokenRepo.verify(plaintext);
}
