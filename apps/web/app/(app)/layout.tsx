import { AppShell } from "@/components/app-shell";
import { getSession, type SessionPayload } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const username = session?.username ?? "user";
  const openItemCount = await getOpenItemCount(session);

  return (
    <AppShell username={username} openItemCount={openItemCount}>
      {children}
    </AppShell>
  );
}

/**
 * The open-items badge count.
 *
 * The shell is a client component, so this is derived on the server and
 * handed down. It is deliberately fault-isolated: this layout wraps all nine
 * routes, and a read-model failure must not take down `/positions`, `/ledger`
 * or `/tax`, none of which have anything to do with a badge. A failure
 * degrades to no badge — the same as no database and no session — and is
 * logged rather than silently swallowed. Where a failure needs to be
 * *visible* it belongs in the page body, which each page already does via
 * `emptyPortfolioSnapshot({ message })`.
 *
 * `getPortfolioSnapshot` is request-memoized, so the snapshot a page derives
 * for its own body is the same one, not a second ledger replay.
 */
async function getOpenItemCount(session: SessionPayload | null): Promise<number> {
  const db = getDb();
  if (!db || !session) return 0;

  try {
    const snapshot = await getPortfolioSnapshot(db, session.householdId);
    return snapshot.openItemCounts.total;
  } catch (error) {
    console.error("open-items badge count unavailable", error);
    return 0;
  }
}
