import { demoPortfolio } from "../../lib/demo-portfolio";

const tone: Record<string, string> = {
  info: "text-[var(--color-fog)]",
  warn: "text-[var(--color-warn)]",
  error: "text-[var(--color-danger)]",
};

export default function OpenItemsPage() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl text-white">Open items</h1>
      <p className="mt-2 text-[var(--color-fog)]">
        Data quality surface — unknown basis, interest variance, reconcile mismatches.
      </p>
      <ul className="mt-8 space-y-4">
        {demoPortfolio.openItems.map((item) => (
          <li
            key={item.id}
            className="border-l-2 border-[var(--color-line)] pl-4"
          >
            <p className={`text-xs uppercase tracking-[0.14em] ${tone[item.severity]}`}>
              {item.kind}
            </p>
            <p className="mt-1 text-white">{item.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
