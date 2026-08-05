import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { household } from "./household";

export const API_TOKEN_SCOPES = ["read", "read_write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * A personal access token for MCP bearer auth. Only the SHA-256 hash of the token is
 * stored — the plaintext is shown to the user exactly once at creation and is not
 * recoverable afterwards. Every token belongs to exactly one household and carries
 * exactly one scope; revocation is immediate (verify rejects once `revoked_at` is set).
 * Created and revoked only through the cookie-authenticated web API, never via MCP.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scope: text("scope", { enum: API_TOKEN_SCOPES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("api_token_household_idx").on(t.householdId),
    // Spec §3: the scope domain is enforced by the database, not just the type.
    check("api_token_scope_check", sql`${t.scope} in ('read', 'read_write')`),
  ],
);
