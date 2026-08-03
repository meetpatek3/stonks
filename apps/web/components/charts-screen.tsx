"use client";

import { Card, Chip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import type { PortfolioSnapshot } from "@/lib/portfolio-shared";
import {
  AllocationBasisChip,
  AllocationPieChart,
  ChartCard,
  UncertaintyNote,
  ValueOverTimeChart,
  groupAllocationByAccount,
  toAllocationSlices,
} from "@/components/portfolio-charts";

/**
 * The fuller chart surface.
 *
 * It shows the same two series as the overview, through the same components,
 * plus the one further cut the read model genuinely supports: the cost split
 * regrouped by account. Nothing here is a second implementation of an
 * overview chart, and nothing is a series the ledger cannot produce — there
 * is no benchmark comparison, for instance, because no benchmark data reaches
 * the read model.
 */
export function ChartsScreen({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const currency = snapshot.reportingCurrency ?? "CAD";
  const minorUnits = snapshot.reportingMinorUnits;

  const accountName = (accountId: string) =>
    snapshot.balances.find((row) => row.accountId === accountId)?.accountName ??
    accountId;

  const hasSeries =
    snapshot.valueOverTime.length > 0 || snapshot.allocation.length > 0;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Portfolio overview</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Charts</h1>
          <div className="flex flex-wrap items-center gap-2">
            {snapshot.reportingCurrency ? (
              <Chip variant="soft">{snapshot.reportingCurrency}</Chip>
            ) : null}
            {snapshot.ledgerVersion > 0 ? (
              <Chip variant="soft" color="accent">
                Ledger v{snapshot.ledgerVersion}
              </Chip>
            ) : null}
          </div>
        </div>
      </header>

      {!hasSeries ? (
        <Card>
          <Card.Content className="p-8">
            <EmptyState>
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <Icon icon="gravity-ui:chart-line" width={24} />
                </EmptyState.Media>
                <EmptyState.Title>Nothing to chart yet</EmptyState.Title>
                <EmptyState.Description>
                  {chartsEmptyReason(snapshot.message)}
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          </Card.Content>
        </Card>
      ) : (
        <>
          {snapshot.totalsAreUncertain ? (
            <UncertaintyNote title="Some balances are excluded">
              A balance is held in a currency other than {currency} with no rate
              available, so it is left out of the value series rather than
              converted at a guessed rate.
            </UncertaintyNote>
          ) : null}

          <ChartCard
            title="Value over time"
            description={`Month-end net worth in ${currency}. Each point is a full replay of every journal posted up to that month end, not a running total.`}
          >
            <ValueOverTimeChart
              points={snapshot.valueOverTime}
              currency={currency}
              minorUnits={minorUnits}
              height={340}
            />
          </ChartCard>

          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
            <ChartCard
              title="Allocation by holding"
              description="Each position's share of pooled ACB cost."
              action={<AllocationBasisChip basis={snapshot.allocationBasis} />}
            >
              <AllocationPieChart
                slices={toAllocationSlices(snapshot.allocation)}
                currency={currency}
                minorUnits={minorUnits}
              />
            </ChartCard>

            <ChartCard
              title="Allocation by account"
              description="The same cost split, grouped by the account each position is held in."
              action={<AllocationBasisChip basis={snapshot.allocationBasis} />}
            >
              <AllocationPieChart
                slices={groupAllocationByAccount(snapshot.allocation, accountName)}
                currency={currency}
                minorUnits={minorUnits}
              />
            </ChartCard>
          </div>

          {snapshot.allocationIsIncomplete ? (
            <UncertaintyNote title="Both cost splits are incomplete">
              A holding was left out because its cost basis is unknown or zero.
              The slices shown still sum to 100%, but they describe less than the
              whole portfolio.
            </UncertaintyNote>
          ) : null}

          <UncertaintyNote status="accent" title="No market-value chart">
            Allocation is drawn from cost because no price source is wired into
            the read model. A market-value split, and any return series built on
            one, would have to be invented, so neither is shown.
          </UncertaintyNote>
        </>
      )}
    </div>
  );
}

function chartsEmptyReason(message: string | undefined): string {
  switch (message) {
    case "DATABASE_URL not configured":
      return "DATABASE_URL is not set, so there is no ledger to replay into a series.";
    case "not authenticated":
      return "Charts are scoped to a household, which comes from the session. Sign in to load them.";
    case "household not found":
      return "The session names a household that no longer exists in the database.";
    case "no accounts":
      return "The household has no accounts, so replay produces neither a value series nor an allocation.";
    default:
      return (
        message ??
        "No journal has been posted yet, so there is no month-end value and no cost to allocate."
      );
  }
}
