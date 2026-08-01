import { demoPortfolio } from "../../lib/demo-portfolio";

export default function ChartsPage() {
  const { allocation, valueOverTime } = demoPortfolio.chartSeries;
  const maxValue = Math.max(...valueOverTime.map((p) => p.value));

  return (
    <div className="animate-rise space-y-12">
      <div>
        <h1 className="font-display text-4xl text-white">Charts</h1>
        <p className="mt-2 text-[var(--color-fog)]">
          Allocation and value over time from the market-data / read-model layer (demo series).
        </p>
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--color-fog)]/70">
          Allocation
        </h2>
        <div className="mt-4 space-y-3">
          {allocation.map((slice) => (
            <div key={slice.label}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-white">{slice.label}</span>
                <span className="font-mono text-[var(--color-fog)]">{slice.value}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
                <div
                  className="h-full rounded-full bg-[var(--color-mint)] transition-all duration-700"
                  style={{ width: `${slice.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-[0.14em] text-[var(--color-fog)]/70">
          Portfolio value
        </h2>
        <div className="mt-4 flex h-48 items-end gap-3 border-b border-[var(--color-line)] pb-0">
          {valueOverTime.map((point) => (
            <div key={point.date} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t-sm bg-gradient-to-t from-[var(--color-mint-dim)] to-[var(--color-mint)]"
                style={{ height: `${(point.value / maxValue) * 100}%` }}
                title={`${point.date}: ${point.value}k`}
              />
              <span className="font-mono text-[10px] text-[var(--color-fog)]/70">{point.date}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
