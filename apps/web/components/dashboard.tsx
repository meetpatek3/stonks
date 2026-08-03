"use client";

import { Card, Chip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { TrendChip } from "@heroui-pro/react/trend-chip";
import { Icon } from "@iconify/react";
import Link from "next/link";
import {
  DISPLAY_LOCALE,
  UNKNOWN,
  formatMoney,
  formatReportingMoney,
  minorToDisplayNumber,
  signedTrend,
} from "@/lib/format";
import type { AccountType } from "@stonks/ledger";
import type {
  BalanceRow,
  PortfolioSnapshot,
  ValuePoint,
} from "@/lib/portfolio-shared";
import {
  AllocationBasisChip,
  AllocationPieChart,
  ChartCard,
  UncertaintyNote,
  ValueOverTimeChart,
  toAllocationSlices,
} from "@/components/portfolio-charts";

/**
 * The portfolio overview — the landing screen.
 *
 * Every figure on it comes from the replayed snapshot; nothing is computed
 * here beyond differences between two figures the read model already derived,
 * and those are labelled as differences rather than as returns. Where the
 * snapshot marks something uncertain (`totalsAreUncertain`,
 * `allocationIsIncomplete`, `allocationBasis`, `ValuePoint.isUncertain`) the
 * flag is rendered next to the figure it affects.
 */

type DashboardProps = {
  snapshot: PortfolioSnapshot;
};

export function Dashboard({ snapshot }: DashboardProps) {
  const currency = snapshot.reportingCurrency ?? "CAD";
  const minorUnits = snapshot.reportingMinorUnits;
  const change = netWorthChange(snapshot.valueOverTime);

  if (snapshot.balances.length === 0) {
    return (
      <Screen
        currency={snapshot.reportingCurrency}
        ledgerVersion={snapshot.ledgerVersion}
      >
        <NoDataState message={snapshot.message} />
      </Screen>
    );
  }

  return (
    <Screen currency={currency} ledgerVersion={snapshot.ledgerVersion}>
      {snapshot.totalsAreUncertain ? (
        <UncertaintyNote title="Totals exclude at least one balance">
          A balance is held in a currency other than {currency} and no rate is
          available to convert it, so it is left out of every total below rather
          than converted at a guessed rate.
        </UncertaintyNote>
      ) : null}

      <KPIGroup className="flex-col md:flex-row">
        <KPI>
          <KPI.Header>
            <KPI.Title>Net worth</KPI.Title>
            <KPI.Icon>
              <Icon icon="gravity-ui:wallet" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <ReportingMoneyValue
              minor={snapshot.netWorthMinor}
              currency={currency}
              minorUnits={minorUnits}
            />
            {change ? (
              <KPI.Trend trend={signedTrend(change.minor)}>
                {formatReportingMoney(change.minor, currency, minorUnits)}
              </KPI.Trend>
            ) : null}
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">
              {change
                ? `Change since ${change.fromMonth}`
                : "Month-end value from replay"}
            </span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Total invested</KPI.Title>
            <KPI.Icon status="success">
              <Icon icon="gravity-ui:chart-column" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <ReportingMoneyValue
              minor={snapshot.totalInvestedMinor}
              currency={currency}
              minorUnits={minorUnits}
            />
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">
              Book value across{" "}
              {snapshot.balancesByType.INVESTMENT.length === 1
                ? "1 account"
                : `${snapshot.balancesByType.INVESTMENT.length} accounts`}
            </span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Total borrowed</KPI.Title>
            <KPI.Icon status="warning">
              <Icon icon="gravity-ui:credit-card" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <ReportingMoneyValue
              minor={snapshot.totalBorrowedMinor}
              currency={currency}
              minorUnits={minorUnits}
            />
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">
              Drawn on{" "}
              {snapshot.balancesByType.CREDIT_FACILITY.length === 1
                ? "1 facility"
                : `${snapshot.balancesByType.CREDIT_FACILITY.length} facilities`}
            </span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Return, net of all costs</KPI.Title>
            <KPI.Icon>
              <Icon icon="gravity-ui:percent" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-muted">
              {UNKNOWN}
            </p>
            <TrendChip trend="neutral">Not derivable</TrendChip>
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">Needs market prices</span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Open data-quality items</KPI.Title>
            <KPI.Icon
              {...(snapshot.openItemCounts.total > 0
                ? { status: "warning" as const }
                : {})}
            >
              <Icon icon="gravity-ui:circle-exclamation" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value
              value={snapshot.openItemCounts.total}
              locale={DISPLAY_LOCALE}
            />
          </KPI.Content>
          <KPI.Footer>
            <Link href="/open-items" className="text-sm text-accent">
              {snapshot.openItemCounts.total > 0
                ? "Review open items"
                : "Nothing outstanding"}
            </Link>
          </KPI.Footer>
        </KPI>
      </KPIGroup>

      <UncertaintyNote status="accent" title="Returns are not derivable yet">
        A return on this screen would be stated net of all costs, with the gross
        figure beside it. Neither is shown, because neither can be derived: a
        period return needs the change in what the holdings are worth, and no
        price source is wired in, so every position is carried at cost.
        Borrowing costs are recorded — they are simply not enough on their own
        to state a return.
      </UncertaintyNote>

      <section className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ChartCard
            title="Value over time"
            description={`Month-end net worth in ${currency}, each point a full replay to that month end.`}
          >
            <ValueOverTimeChart
              points={snapshot.valueOverTime}
              currency={currency}
              minorUnits={minorUnits}
            />
            {snapshot.valueOverTime.some((point) => point.isUncertain) ? (
              <UncertaintyNote title="Some months exclude a balance">
                A month marked in its tooltip left out a balance held in another
                currency, because no rate was available to convert it.
              </UncertaintyNote>
            ) : null}
          </ChartCard>
        </div>

        <div className="min-w-0">
          <ChartCard
            title="Allocation"
            description="Each holding's share of pooled ACB cost."
            action={<AllocationBasisChip basis={snapshot.allocationBasis} />}
          >
            <AllocationPieChart
              slices={toAllocationSlices(snapshot.allocation)}
              currency={currency}
              minorUnits={minorUnits}
            />
            {snapshot.allocationIsIncomplete ? (
              <UncertaintyNote title="This split is incomplete">
                A holding was left out because its cost basis is unknown or zero.
                The slices shown still sum to 100%, but they describe less than
                the whole portfolio.
              </UncertaintyNote>
            ) : null}
          </ChartCard>
        </div>
      </section>

      <AccountBalances snapshot={snapshot} />
    </Screen>
  );
}

/**
 * A reporting-currency headline figure.
 *
 * `KPI.Value` wraps `NumberValue`, which needs a `number` — so a figure whose
 * scale is unknown cannot go through it at all, and renders as the `UNKNOWN`
 * marker instead. `minorToDisplayNumber` is the only sanctioned money→number
 * conversion and it is display-only.
 */
function ReportingMoneyValue({
  minor,
  currency,
  minorUnits,
}: {
  minor: string;
  currency: string;
  minorUnits: number | null;
}) {
  if (minorUnits === null) {
    return (
      <p
        className="text-3xl font-semibold tracking-tight tabular-nums text-muted"
        title={`No minor-unit scale is recorded for ${currency}.`}
      >
        {UNKNOWN}
      </p>
    );
  }

  return (
    <KPI.Value
      value={minorToDisplayNumber(minor, minorUnits)}
      style="currency"
      currency={currency}
      locale={DISPLAY_LOCALE}
      minimumFractionDigits={minorUnits}
      maximumFractionDigits={minorUnits}
    />
  );
}

/**
 * The page frame. The currency and ledger-version chips render only when the
 * snapshot actually carries them: with no database there is no reporting
 * currency and no replay, and a "CAD / Ledger v0" pair would state both.
 */
function Screen({
  currency,
  ledgerVersion,
  children,
}: {
  currency: string | undefined;
  ledgerVersion: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Portfolio overview</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <div className="flex flex-wrap items-center gap-2">
            {currency ? <Chip variant="soft">{currency}</Chip> : null}
            {ledgerVersion > 0 ? (
              <Chip variant="soft" color="accent">
                Ledger v{ledgerVersion}
              </Chip>
            ) : null}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account balances                                                    */
/* ------------------------------------------------------------------ */

/**
 * How each account type is presented, keyed by the type itself.
 *
 * `Record<AccountType, …>` requires a key for every member of the ledger's
 * union, so adding a member there is a compile error here — the group cannot
 * silently stop rendering. `order` carries the reading order, because an
 * object's keys are not a contract about display order.
 */
type AccountGroupMeta = {
  order: number;
  label: string;
  note: string;
  isLiability: boolean;
};

const ACCOUNT_GROUPS: Record<AccountType, AccountGroupMeta> = {
  INVESTMENT: {
    order: 0,
    label: "Investments",
    note: "Cash and holdings at cost",
    isLiability: false,
  },
  CASH: {
    order: 1,
    label: "Cash",
    note: "Included in net worth",
    isLiability: false,
  },
  RECEIVABLE: {
    order: 2,
    label: "Receivables",
    note: "Owed to the household",
    isLiability: false,
  },
  CREDIT_FACILITY: {
    order: 3,
    label: "Borrowing",
    note: "Owed by the household",
    isLiability: true,
  },
  EXTERNAL: {
    order: 4,
    label: "Outside world",
    note: "Counterparties — never part of household value",
    isLiability: false,
  },
};

function AccountBalances({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const groups = (
    Object.entries(ACCOUNT_GROUPS) as [AccountType, AccountGroupMeta][]
  )
    .filter(([type]) => snapshot.balancesByType[type].length > 0)
    .sort(([, a], [, b]) => a.order - b.order);

  return (
    <section className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Account balances</h2>
        <span className="text-sm text-muted">Derived by ledger replay</span>
      </div>

      {groups.map(([type, group]) => (
        <div key={type} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium text-foreground">{group.label}</h3>
            {group.isLiability ? (
              <Chip size="sm" variant="soft" color="danger">
                Liability
              </Chip>
            ) : null}
            <span className="text-sm text-muted">{group.note}</span>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {snapshot.balancesByType[type].map((row) => (
              <BalanceCard
                key={row.accountId}
                row={row}
                isLiability={group.isLiability}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function BalanceCard({
  row,
  isLiability,
}: {
  row: BalanceRow;
  isLiability: boolean;
}) {
  return (
    <Card className="min-w-0">
      <Card.Header className="flex items-start justify-between gap-3 p-5 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="truncate text-base font-medium">
            {row.accountName}
          </Card.Title>
          <Card.Description className="truncate text-sm text-muted">
            {row.accountId}
          </Card.Description>
        </div>
        <Chip size="sm" variant="soft" color={isLiability ? "danger" : "default"}>
          {row.currency}
        </Chip>
      </Card.Header>
      <Card.Content className="p-5 pt-2">
        <p
          className={`text-2xl font-semibold tabular-nums tracking-tight ${
            isLiability ? "text-danger" : "text-foreground"
          }`}
        >
          {formatMoney(row.minor, row.currency, row.minorUnits)}
        </p>
      </Card.Content>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The no-data state, stating the reason the read model gave rather than a
 * generic "nothing here". Each branch names something the user can act on.
 */
function NoDataState({ message }: { message?: string | undefined }) {
  const { title, description } = noDataReason(message);

  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:briefcase" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>{title}</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function noDataReason(message: string | undefined): {
  title: string;
  description: string;
} {
  switch (message) {
    case "DATABASE_URL not configured":
      return {
        title: "No database configured",
        description:
          "DATABASE_URL is not set, so there is no ledger to replay. Set it and restart the app.",
      };
    case "not authenticated":
      return {
        title: "Not signed in",
        description:
          "The portfolio is scoped to a household, which comes from the session. Sign in to load it.",
      };
    case "household not found":
      return {
        title: "Household not found",
        description:
          "The session names a household that no longer exists in the database.",
      };
    case "no accounts":
      return {
        title: "No accounts yet",
        description:
          "The household has no accounts, so there is nothing to replay. Create an account, then post a journal.",
      };
    default:
      return {
        title: "No balances yet",
        description:
          message ??
          "The household has accounts but no posted journals, so replay produces no balances. Post a transaction to see it here.",
      };
  }
}

/* ------------------------------------------------------------------ */

/**
 * Month-over-month change in net worth, from the two most recent points of
 * the derived series.
 *
 * A difference between two derived figures, and labelled as one — it is not a
 * return: it includes deposits and withdrawals, and excludes any change in
 * what the holdings are worth, since they are carried at cost.
 */
function netWorthChange(points: readonly ValuePoint[]): {
  minor: string;
  fromMonth: string;
} | null {
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!last || !previous) return null;

  return {
    minor: (BigInt(last.valueMinor) - BigInt(previous.valueMinor)).toString(),
    fromMonth: previous.month,
  };
}
