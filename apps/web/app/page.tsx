import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  const username = session?.username ?? "user";
  const db = getDb();
  const snapshot = db
    ? await getPortfolioSnapshot(db)
    : { balances: [], ledgerVersion: 0, message: "DATABASE_URL not configured" };

  return (
    <AppShell username={username}>
      <Dashboard snapshot={snapshot} />
    </AppShell>
  );
}
