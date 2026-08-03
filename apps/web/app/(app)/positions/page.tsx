import { PositionsScreen } from "@/components/positions-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  return <PositionsScreen snapshot={await loadSessionSnapshot()} />;
}
