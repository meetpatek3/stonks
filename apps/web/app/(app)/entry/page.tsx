import { EntryScreen } from "@/components/entry-screen";
import { loadEntryFormData } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function EntryPage() {
  const data = await loadEntryFormData();
  return (
    <EntryScreen
      accounts={data.accounts}
      householdAccounts={data.householdAccounts}
      externalAccountId={data.externalAccountId}
      reportingCurrency={data.reportingCurrency}
      minorUnits={data.minorUnits}
      mruAccountId={data.mruAccountId}
      defaultTradeDate={data.defaultTradeDate}
      cashByAccountId={data.cashByAccountId}
      positions={data.positions}
      securityIds={data.securityIds}
      message={data.message}
    />
  );
}
