import { LedgerScreen } from "@/components/ledger-screen";
import { loadSessionJournalRows } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const { rows, accounts, message } = await loadSessionJournalRows();
  return <LedgerScreen rows={rows} accounts={accounts} message={message} />;
}
