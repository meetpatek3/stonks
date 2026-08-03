import { TaxScreen } from "@/components/tax-screen";
import { loadSessionSnapshot } from "@/lib/portfolio";
import { parseTaxYearParam } from "@/lib/tax-summary";

export const dynamic = "force-dynamic";

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const params = await searchParams;
  const taxYear = parseTaxYearParam(params.year);
  const snapshot = await loadSessionSnapshot(
    taxYear === undefined ? {} : { taxYear },
  );
  return <TaxScreen snapshot={snapshot} />;
}
