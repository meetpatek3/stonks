import { demoPortfolio, formatCadMinor } from "../../lib/demo-portfolio";

export default function LedgerPage() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl text-white">Ledger</h1>
      <p className="mt-2 text-[var(--color-fog)]">
        Posted journals in deterministic order. Source of truth for every balance.
      </p>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[var(--color-line)] text-[var(--color-fog)]/70">
            <tr>
              <th className="py-3 font-medium">Date</th>
              <th className="py-3 font-medium">Type</th>
              <th className="py-3 font-medium">Memo</th>
              <th className="py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {demoPortfolio.journals.map((j) => (
              <tr key={j.id} className="text-white/90">
                <td className="py-3 font-mono text-xs">{j.tradeDate}</td>
                <td className="py-3">{j.type}</td>
                <td className="py-3 text-[var(--color-fog)]">{j.memo}</td>
                <td className="py-3 text-right font-mono text-[var(--color-mint)]">
                  {formatCadMinor(j.amountMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
