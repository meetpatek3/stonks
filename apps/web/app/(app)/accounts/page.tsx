import { createAccountRepo, createFacilityTermsRepo } from "@stonks/db";
import { AccountsScreen } from "@/components/accounts-screen";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { todayIsoDate } from "@/lib/journals";
import { emptyPortfolioSnapshot } from "@/lib/portfolio-shared";
import { getPortfolioSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ includeClosed?: string | string[] }>;
}) {
  const db = getDb();
  if (!db) {
    return (
      <AccountsScreen
        snapshot={emptyPortfolioSnapshot({ message: "DATABASE_URL not configured" })}
        accounts={[]}
        currencies={[]}
        includeClosed={false}
      />
    );
  }

  const session = await getSession();
  if (!session) {
    return (
      <AccountsScreen
        snapshot={emptyPortfolioSnapshot({ message: "not authenticated" })}
        accounts={[]}
        currencies={[]}
        includeClosed={false}
      />
    );
  }

  const params = await searchParams;
  const includeClosed = params.includeClosed === "true";
  const repo = createAccountRepo(db);
  const facilityRepo = createFacilityTermsRepo(db);
  const asOf = todayIsoDate();
  const [snapshot, accounts, currencies, effectiveTerms] = await Promise.all([
    getPortfolioSnapshot(db, session.householdId),
    repo.list(session.householdId, { includeClosed }),
    repo.listCurrencies(),
    facilityRepo.listEffectiveTerms(session.householdId, asOf),
  ]);

  return (
    <AccountsScreen
      snapshot={snapshot}
      accounts={accounts}
      currencies={currencies}
      includeClosed={includeClosed}
      facilityTermsAccountIds={effectiveTerms.map(
        (row) => row.terms.facilityAccountId,
      )}
    />
  );
}
