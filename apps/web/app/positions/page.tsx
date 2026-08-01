import { demoPortfolio, formatCadMinor } from "../../lib/demo-portfolio";

export default function PositionsPage() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl text-white">Positions</h1>
      <p className="mt-2 text-[var(--color-fog)]">
        Quantity and reporting-currency cost from ACB/FIFO replay. Borrow cost attribution lands in
        Plan 4.
      </p>
      <ul className="mt-8 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {demoPortfolio.positions.map((pos) => (
          <li key={pos.key} className="grid gap-2 py-5 md:grid-cols-[1fr_auto_auto] md:items-center">
            <div>
              <p className="text-xl text-white">{pos.symbol}</p>
              <p className="font-mono text-xs text-[var(--color-fog)]/70">{pos.key}</p>
            </div>
            <p className="font-mono text-sm text-[var(--color-fog)]">
              qty {pos.quantity.replace(/0+$/, "").replace(/\.$/, "")}
            </p>
            <p className="font-mono text-sm text-[var(--color-mint)]">
              cost {formatCadMinor(pos.costReportingMinor)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
