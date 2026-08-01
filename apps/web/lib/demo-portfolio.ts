/** Demo household used when DATABASE_URL is unavailable (preview / local without Postgres). */

export type DemoBalance = { accountId: string; name: string; minor: string; currency: string };
export type DemoPosition = {
  key: string;
  symbol: string;
  quantity: string;
  costReportingMinor: string;
  currency: string;
};
export type DemoJournal = {
  id: string;
  type: string;
  tradeDate: string;
  memo: string;
  amountMinor: string;
};
export type DemoOpenItem = {
  id: string;
  kind: string;
  message: string;
  severity: "info" | "warn" | "error";
};
export type DemoTax = {
  year: number;
  realizedGainsMinor: string;
  taxableCapitalGainsMinor: string;
  dividendIncomeMinor: string;
  deductibleInterestMinor: string;
  flags: string[];
  disclaimer: string;
};

export const demoPortfolio = {
  mode: "demo" as const,
  householdName: "Household ledger",
  reportingCurrency: "CAD",
  netWorthMinor: "24835000",
  periodReturnBps: 842,
  balances: [
    { accountId: "cash", name: "Chequing", minor: "1825000", currency: "CAD" },
    { accountId: "investment", name: "Brokerage", minor: "26510000", currency: "CAD" },
    { accountId: "facility", name: "Investment loan", minor: "-3500000", currency: "CAD" },
  ] satisfies DemoBalance[],
  positions: [
    {
      key: "investment:XEQT",
      symbol: "XEQT",
      quantity: "420.00000000",
      costReportingMinor: "12600000",
      currency: "CAD",
    },
    {
      key: "investment:VFV",
      symbol: "VFV",
      quantity: "85.00000000",
      costReportingMinor: "8920000",
      currency: "CAD",
    },
    {
      key: "investment:AAPL",
      symbol: "AAPL",
      quantity: "12.00000000",
      costReportingMinor: "4980000",
      currency: "CAD",
    },
  ] satisfies DemoPosition[],
  journals: [
    {
      id: "j1",
      type: "DEPOSIT",
      tradeDate: "2024-01-02",
      memo: "Payroll transfer",
      amountMinor: "500000",
    },
    {
      id: "j2",
      type: "BUY",
      tradeDate: "2024-01-05",
      memo: "Buy XEQT",
      amountMinor: "250000",
    },
    {
      id: "j3",
      type: "INTEREST_CHARGED",
      tradeDate: "2024-01-31",
      memo: "Facility interest (actual)",
      amountMinor: "12450",
    },
    {
      id: "j4",
      type: "DIVIDEND",
      tradeDate: "2024-02-15",
      memo: "VFV distribution",
      amountMinor: "18600",
    },
  ] satisfies DemoJournal[],
  openItems: [
    {
      id: "oi1",
      kind: "UNKNOWN_COST",
      message: "Opening lot for legacy AAPL lacks cost basis",
      severity: "warn",
    },
    {
      id: "oi2",
      kind: "INTEREST_VARIANCE",
      message: "Modelled interest exceeds actual by CAD 1.20 for Jan",
      severity: "info",
    },
    {
      id: "oi3",
      kind: "RECONCILE_MISMATCH",
      message: "Brokerage statement 2024-01 differs by CAD 0.03",
      severity: "error",
    },
  ] satisfies DemoOpenItem[],
  tax: {
    year: 2024,
    realizedGainsMinor: "420000",
    taxableCapitalGainsMinor: "210000",
    dividendIncomeMinor: "18600",
    deductibleInterestMinor: "12450",
    flags: ["SUPERFICIAL_LOSS candidate on j-sell-12 (flag only — not applied)"],
    disclaimer:
      "This is not tax advice. Figures are computational aids from your journals and configurable rules.",
  } satisfies DemoTax,
  chartSeries: {
    allocation: [
      { label: "XEQT", value: 48 },
      { label: "VFV", value: 34 },
      { label: "AAPL", value: 18 },
    ],
    valueOverTime: [
      { date: "2024-01", value: 210 },
      { date: "2024-02", value: 218 },
      { date: "2024-03", value: 225 },
      { date: "2024-04", value: 231 },
      { date: "2024-05", value: 240 },
      { date: "2024-06", value: 248 },
    ],
  },
};

export function formatCadMinor(minor: string | bigint): string {
  const n = typeof minor === "bigint" ? minor : BigInt(minor);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${sign}$${whole.toLocaleString("en-CA")}.${frac}`;
}
