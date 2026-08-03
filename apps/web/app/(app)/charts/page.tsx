import { ChartsScreen } from "@/components/charts-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function ChartsPage() {
  return <ChartsScreen snapshot={await loadSessionSnapshot()} />;
}
