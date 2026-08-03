import { createTokenRepo } from "@stonks/db";
import { SettingsScreen } from "@/components/settings-screen";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Settings — MCP access token management. Tokens are minted and revoked here
 * (via the cookie-authenticated /api/tokens API), never over MCP, so a
 * compromised agent cannot escalate its own privileges. The list projection
 * carries no token hash — there is nothing secret to render.
 */
export default async function SettingsPage() {
  const session = await getSession();
  const db = getDb();

  if (!session) {
    return <SettingsScreen tokens={[]} message="not authenticated" />;
  }
  if (!db) {
    return <SettingsScreen tokens={[]} message="DATABASE_URL not configured" />;
  }

  const rows = await createTokenRepo(db).list(session.householdId);

  return (
    <SettingsScreen
      tokens={rows.map((row) => ({
        id: row.id,
        name: row.name,
        scope: row.scope,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      }))}
    />
  );
}
