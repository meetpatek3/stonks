import { demoPortfolio, formatCadMinor } from "../../lib/demo-portfolio";

export default function TaxPage() {
  const t = demoPortfolio.tax;
  return (
    <div className="animate-rise max-w-2xl">
      <h1 className="font-display text-4xl text-white">Tax {t.year}</h1>
      <p className="mt-2 text-[var(--color-fog)]">Canada module — flag-only adjustments.</p>

      <dl className="mt-8 space-y-4 border-y border-[var(--color-line)] py-6">
        <Row label="Realized gains" value={formatCadMinor(t.realizedGainsMinor)} />
        <Row label="Taxable capital gains (50%)" value={formatCadMinor(t.taxableCapitalGainsMinor)} />
        <Row label="Dividend income" value={formatCadMinor(t.dividendIncomeMinor)} />
        <Row
          label="Deductible investment interest"
          value={formatCadMinor(t.deductibleInterestMinor)}
        />
      </dl>

      <div className="mt-6">
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--color-warn)]">Flags</h2>
        <ul className="mt-3 space-y-2 text-sm text-[var(--color-fog)]">
          {t.flags.map((f) => (
            <li key={f}>• {f}</li>
          ))}
        </ul>
      </div>

      <p className="mt-8 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-4 py-3 text-sm text-[var(--color-warn)]">
        {t.disclaimer}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[var(--color-fog)]">{label}</dt>
      <dd className="font-mono text-white">{value}</dd>
    </div>
  );
}
