import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
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

  // The shell is a client component, so the open-items count is derived here
  // and handed down as a prop. With no database or no session there is
  // nothing to count and no badge is rendered — rather than a zero badge or
  // an error in the navigation.
  const db = getDb();
  const snapshot =
    db && session ? await getPortfolioSnapshot(db, session.householdId) : null;
  const openItemCount = snapshot?.openItemCounts.total ?? 0;

  return (
    <AppShell username={username} openItemCount={openItemCount}>
      {children}
    </AppShell>
  );
}
