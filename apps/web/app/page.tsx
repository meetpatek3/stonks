import Link from "next/link";
import { demoPortfolio, formatCadMinor } from "../lib/demo-portfolio";

export default function HomePage() {
  const p = demoPortfolio;
  const returnPct = (p.periodReturnBps / 100).toFixed(2);

  return (
    <div className="space-y-12">
      <section className="animate-rise relative overflow-hidden rounded-none border border-[var(--color-line)] bg-[var(--color-panel)]/70 px-6 py-14 md:px-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'%3E%3Crect fill='%230b1210' width='1600' height='900'/%3E%3Cpath d='M0 620 C220 540 340 700 520 620 C720 520 860 700 1080 580 C1280 480 1420 620 1600 540 L1600 900 L0 900 Z' fill='%231f8f5c' fill-opacity='0.25'/%3E%3Cpath d='M0 700 C260 640 400 760 640 680 C900 580 1040 740 1280 660 C1420 610 1520 700 1600 680 L1600 900 L0 900 Z' fill='%233dffa8' fill-opacity='0.12'/%3E%3C/svg%3E\")",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative max-w-2xl">
          <h1 className="font-display text-5xl leading-none tracking-tight text-white md:text-7xl">
            stonks
          </h1>
          <p className="mt-5 max-w-lg text-lg text-[var(--color-fog)]">
            What you actually made after commissions, currency, and borrowed money.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/entry"
              className="rounded-md bg-[var(--color-mint)] px-5 py-2.5 text-sm font-medium text-[var(--color-ink)] transition hover:brightness-110"
            >
              Record a trade
            </Link>
            <Link
              href="/ledger"
              className="rounded-md border border-[var(--color-line)] px-5 py-2.5 text-sm text-white transition hover:border-[var(--color-mint)]/50"
            >
              View ledger
            </Link>
          </div>
        </div>
      </section>

      <section className="animate-rise-delay grid gap-8 md:grid-cols-3">
        <Metric
          label="Net worth"
          value={formatCadMinor(p.netWorthMinor)}
          hint="Reporting currency CAD"
        />
        <Metric label="Period return" value={`+${returnPct}%`} hint="Net of modelled costs" />
        <Metric
          label="Open items"
          value={String(p.openItems.length)}
          hint="Unknown basis, variance, reconcile"
        />
      </section>

      <section className="animate-rise-delay">
        <h2 className="font-display text-2xl text-white">Accounts</h2>
        <p className="mt-1 text-sm text-[var(--color-fog)]/80">
          Balances derived from posted journals (demo data).
        </p>
        <ul className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {p.balances.map((b) => (
            <li key={b.accountId} className="flex items-center justify-between py-4">
              <span className="text-white">{b.name}</span>
              <span className="font-mono text-sm text-[var(--color-mint)]">
                {formatCadMinor(b.minor)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-fog)]/70">{label}</p>
      <p className="mt-2 font-display text-3xl text-white">{value}</p>
      <p className="mt-1 text-sm text-[var(--color-fog)]/70">{hint}</p>
    </div>
  );
}
