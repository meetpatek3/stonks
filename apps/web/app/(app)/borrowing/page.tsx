import { BorrowingScreen } from "@/components/borrowing-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function BorrowingPage() {
  return <BorrowingScreen snapshot={await loadSessionSnapshot()} />;
}
