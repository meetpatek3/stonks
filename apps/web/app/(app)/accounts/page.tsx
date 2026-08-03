import { AccountsScreen } from "@/components/accounts-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  return <AccountsScreen snapshot={await loadSessionSnapshot()} />;
}
