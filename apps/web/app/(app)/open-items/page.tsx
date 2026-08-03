import { OpenItemsScreen } from "@/components/open-items-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function OpenItemsPage() {
  return <OpenItemsScreen snapshot={await loadSessionSnapshot()} />;
}
