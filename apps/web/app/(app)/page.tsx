import { Dashboard } from "@/components/dashboard";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  const db = getDb();

  const snapshot =
    db && session
      ? await getPortfolioSnapshot(db, session.householdId)
      : {
          balances: [],
          ledgerVersion: 0,
          message: !db ? "DATABASE_URL not configured" : "not authenticated",
        };

  return <Dashboard snapshot={snapshot} />;
}
