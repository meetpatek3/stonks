import { Dashboard } from "@/components/dashboard";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <Dashboard snapshot={await loadSessionSnapshot()} />;
}
