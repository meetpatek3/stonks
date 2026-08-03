"use client";

import { Card, Chip, Separator } from "@heroui/react";
import { ChartTooltip } from "@heroui-pro/react/chart-tooltip";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { LineChart } from "@heroui-pro/react/line-chart";
import { PieChart } from "@heroui-pro/react/pie-chart";
import { Icon } from "@iconify/react";
import {
  DISPLAY_LOCALE,
  UNKNOWN,
  formatBps,
  formatCompactNumber,
  formatMoney,
  minorToDisplayNumber,
} from "@/lib/format";
import {
  toInterestChartRows,
  toUseBreakdownSlices,
  type InterestChartRow,
  type UseBreakdownSlice,
} from "@/lib/borrowing";
import type {
  BorrowingSummary,
  FacilityBorrowing,
  PortfolioSnapshot,
} from "@/lib/portfolio-shared";
import { ChartCard, UncertaintyNote } from "@/components/portfolio-charts";

/**
 * Borrowing and interest — the screen the product is named for.
 *
 * Every figure comes off `snapshot.borrowing`. Modelled interest is always an
 * estimate and is labelled as such wherever it appears. Where terms or a
 * benchmark curve are missing, the field is `null` and the reason is shown —
 * never a substituted zero rate.
 */

type BorrowingScreenProps = {
  snapshot: PortfolioSnapshot;
};

export function BorrowingScreen({ snapshot }: BorrowingScreenProps) {
  const borrowing = snapshot.borrowing;
  const currency = snapshot.reportingCurrency ?? "CAD";
  const minorUnits = snapshot.reportingMinorUnits;

  if (borrowing.facilities.length === 0) {
    return (
      <Screen currency={snapshot.reportingCurrency} ledgerVersion={snapshot.ledgerVersion}>
        <NoFacilitiesState message={snapshot.message} hasAccounts={snapshot.balances.length > 0} />
      </Screen>
    );
  }

  return (
    <Screen currency={currency} ledgerVersion={snapshot.ledgerVersion}>
      {borrowing.outstandingIsUncertain ? (
        <UncertaintyNote title="Outstanding balance excludes at least one facility">
          A credit facility is held in a currency other than {currency} and no
          rate is available to convert it, so it is left out of the household
          total rather than converted at a guessed rate.
        </UncertaintyNote>
      ) : null}

      <BorrowingKpis
        borrowing={borrowing}
        currency={currency}
        minorUnits={minorUnits}
      />

      {borrowing.uncertaintyReasons.length > 0 ? (
        <UncertaintyNote title="Some modelled figures could not be derived">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {borrowing.uncertaintyReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </UncertaintyNote>
      ) : null}

      <div className="flex min-w-0 flex-col gap-6">
        {borrowing.facilities.map((facility) => (
          <FacilitySection
            key={facility.accountId}
            facility={facility}
            reportingCurrency={currency}
            reportingMinorUnits={minorUnits}
          />
        ))}
      </div>

      <MethodNote />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Household KPIs                                                      */
/* ------------------------------------------------------------------ */

function BorrowingKpis({
  borrowing,
  currency,
  minorUnits,
}: {
  borrowing: BorrowingSummary;
  currency: string;
  minorUnits: number | null;
}) {
  const interestYtd = borrowing.interestChargedYtdMinor;
  const investmentShare = borrowing.investmentShareBps;
  const rate = borrowing.effectiveRateBps;

  return (
    <KPIGroup className="flex-col md:flex-row">
      <KPI>
        <KPI.Header>
          <KPI.Title>Outstanding balance</KPI.Title>
          <KPI.Icon status="warning">
            <Icon icon="gravity-ui:credit-card" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <ReportingMoneyValue
            minor={borrowing.outstandingMinor}
            currency={currency}
            minorUnits={minorUnits}
          />
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            Drawn on{" "}
            {borrowing.facilities.length === 1
              ? "1 facility"
              : `${borrowing.facilities.length} facilities`}
          </span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Effective rate</KPI.Title>
          <KPI.Icon>
            <Icon icon="gravity-ui:percent" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <p
            className={`text-3xl font-semibold tracking-tight tabular-nums ${
              rate === null ? "text-muted" : ""
            }`}
          >
            {rate === null ? UNKNOWN : formatBps(rate)}
          </p>
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            {rate === null
              ? "Needs facility terms and a benchmark rate"
              : "Benchmark + spread, as of today"}
          </span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Interest charged YTD</KPI.Title>
          <KPI.Icon>
            <Icon icon="gravity-ui:calendar" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          {interestYtd === null ? (
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-muted">
              {UNKNOWN}
            </p>
          ) : (
            <ReportingMoneyValue
              minor={interestYtd}
              currency={currency}
              minorUnits={minorUnits}
            />
          )}
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">Posted INTEREST_CHARGED journals</span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Share attributed to investments</KPI.Title>
          <KPI.Icon status="success">
            <Icon icon="gravity-ui:chart-pie" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <p
            className={`text-3xl font-semibold tracking-tight tabular-nums ${
              investmentShare === null ? "text-muted" : ""
            }`}
          >
            {investmentShare === null ? UNKNOWN : formatBps(investmentShare)}
          </p>
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            {investmentShare === null
              ? "Nothing outstanding to attribute"
              : "Of current facility balances"}
          </span>
        </KPI.Footer>
      </KPI>
    </KPIGroup>
  );
}

/* ------------------------------------------------------------------ */
/* Per-facility detail                                                 */
/* ------------------------------------------------------------------ */

function FacilitySection({
  facility,
  reportingCurrency,
  reportingMinorUnits,
}: {
  facility: FacilityBorrowing;
  reportingCurrency: string;
  reportingMinorUnits: number | null;
}) {
  const useSlices = toUseBreakdownSlices(facility.useBreakdown);
  const chartRows =
    reportingMinorUnits === null
      ? []
      : toInterestChartRows(facility.interestOverTime, reportingMinorUnits);
  const variance = facility.variance;

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-medium">{facility.accountName}</h2>
          <p className="text-sm text-muted">{facility.accountId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="soft" color="danger">
            Liability
          </Chip>
          <Chip size="sm" variant="soft">
            {facility.currency}
          </Chip>
        </div>
      </div>

      <Card className="min-w-0">
        <Card.Content className="grid min-w-0 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Outstanding"
            value={formatMoney(
              facility.outstandingMinor,
              facility.currency,
              facility.minorUnits,
            )}
          />
          <Fact
            label="Effective rate"
            value={
              facility.effectiveRateBps === null
                ? UNKNOWN
                : formatBps(facility.effectiveRateBps)
            }
            muted={facility.effectiveRateBps === null}
          />
          <Fact
            label="Interest charged YTD"
            value={formatMoney(
              facility.interestChargedYtdMinor,
              facility.currency,
              facility.minorUnits,
            )}
          />
          <Fact
            label="Investment share of balance"
            value={
              facility.investmentShareBps === null
                ? UNKNOWN
                : formatBps(facility.investmentShareBps)
            }
            muted={facility.investmentShareBps === null}
          />
        </Card.Content>
      </Card>

      <section className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ChartCard
          title="Facility use"
          description="How borrowed funds are attributed across uses, from replayed facility-use slices."
        >
          <UseBreakdownPie
            slices={useSlices}
            currency={facility.currency}
            minorUnits={facility.minorUnits}
          />
        </ChartCard>

        <ChartCard
          title="Interest over time"
          description="Monthly posted interest versus modelled accrual. Modelled figures are estimates."
          action={
            <Chip size="sm" variant="soft" color="warning">
              Modelled is an estimate
            </Chip>
          }
        >
          <InterestOverTimeChart
            rows={chartRows}
            currency={facility.currency}
            minorUnits={facility.minorUnits}
          />
        </ChartCard>
      </section>

      <VarianceCard
        facility={facility}
        variance={variance}
        reportingCurrency={reportingCurrency}
        reportingMinorUnits={reportingMinorUnits}
      />
    </section>
  );
}

function Fact({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={`text-xl font-semibold tracking-tight tabular-nums ${
          muted ? "text-muted" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function UseBreakdownPie({
  slices,
  currency,
  minorUnits,
}: {
  slices: UseBreakdownSlice[];
  currency: string;
  minorUnits: number;
}) {
  if (slices.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>Nothing outstanding</EmptyState.Title>
          <EmptyState.Description>
            This facility has no drawn balance to attribute across uses.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  const data = slices.map((slice) => ({
    ...slice,
    value: slice.bps ?? 0,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PieChart height={260}>
        <PieChart.Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={1}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((datum) => (
            <PieChart.Cell key={datum.key} fill={datum.token} />
          ))}
        </PieChart.Pie>
        <PieChart.Tooltip
          content={<UseTooltip currency={currency} minorUnits={minorUnits} />}
        />
      </PieChart>

      <ul className="flex flex-col gap-2">
        {data.map((datum) => (
          <li key={datum.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: datum.token }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {datum.label}
            </span>
            <span className="tabular-nums text-muted">
              {datum.bps === null ? UNKNOWN : formatBps(datum.bps)}
            </span>
            <span className="tabular-nums text-foreground">
              {formatMoney(datum.owedMinor, currency, minorUnits)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UseTooltip({
  active,
  payload,
  currency,
  minorUnits,
}: {
  active?: boolean;
  payload?: { payload?: UseBreakdownSlice & { value: number } }[];
  currency: string;
  minorUnits: number;
}) {
  if (!active) return null;
  const datum = payload?.[0]?.payload;
  if (!datum) return null;

  return (
    <ChartTooltip active>
      <ChartTooltip.Header>{datum.label}</ChartTooltip.Header>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={datum.token} />
        <ChartTooltip.Label>Owed</ChartTooltip.Label>
        <ChartTooltip.Value>
          {formatMoney(datum.owedMinor, currency, minorUnits)}
        </ChartTooltip.Value>
      </ChartTooltip.Item>
      <ChartTooltip.Item>
        <ChartTooltip.Label>Share</ChartTooltip.Label>
        <ChartTooltip.Value>
          {datum.bps === null ? UNKNOWN : formatBps(datum.bps)}
        </ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}

function InterestOverTimeChart({
  rows,
  currency,
  minorUnits,
}: {
  rows: InterestChartRow[];
  currency: string;
  minorUnits: number;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No interest in this period</EmptyState.Title>
          <EmptyState.Description>
            No INTEREST_CHARGED journals and no modelled accrual fall in the
            year-to-date window.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  const hasModelled = rows.some((row) => row.modelled !== undefined);

  return (
    <LineChart
      data={rows}
      height={260}
      width="100%"
      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
    >
      <LineChart.Grid strokeDasharray="3 3" vertical={false} />
      <LineChart.XAxis
        dataKey="month"
        tickLine={false}
        axisLine={false}
        minTickGap={16}
      />
      <LineChart.YAxis
        width={56}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value: number) => formatCompactNumber(value)}
      />
      <LineChart.Tooltip
        content={
          <InterestTooltip currency={currency} minorUnits={minorUnits} />
        }
      />
      <LineChart.Line
        type="monotone"
        dataKey="actual"
        name="Actual"
        stroke="var(--chart-1)"
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
      />
      {hasModelled ? (
        <LineChart.Line
          type="monotone"
          dataKey="modelled"
          name="Modelled (estimate)"
          stroke="var(--chart-3)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      ) : null}
    </LineChart>
  );
}

function InterestTooltip({
  active,
  label,
  payload,
  currency,
  minorUnits,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { payload?: InterestChartRow; dataKey?: string | number }[];
  currency: string;
  minorUnits: number;
}) {
  if (!active) return null;
  const datum = payload?.[0]?.payload;
  if (!datum) return null;

  return (
    <ChartTooltip active>
      <ChartTooltip.Header>{String(label ?? datum.month)}</ChartTooltip.Header>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color="var(--chart-1)" />
        <ChartTooltip.Label>Actual</ChartTooltip.Label>
        <ChartTooltip.Value>
          {formatMoney(datum.actualMinor, currency, minorUnits)}
        </ChartTooltip.Value>
      </ChartTooltip.Item>
      {datum.modelledMinor !== undefined ? (
        <ChartTooltip.Item>
          <ChartTooltip.Indicator color="var(--chart-3)" />
          <ChartTooltip.Label>Modelled (estimate)</ChartTooltip.Label>
          <ChartTooltip.Value>
            {formatMoney(datum.modelledMinor, currency, minorUnits)}
          </ChartTooltip.Value>
        </ChartTooltip.Item>
      ) : (
        <ChartTooltip.Item>
          <ChartTooltip.Label>Modelled</ChartTooltip.Label>
          <ChartTooltip.Value>{UNKNOWN}</ChartTooltip.Value>
        </ChartTooltip.Item>
      )}
    </ChartTooltip>
  );
}

function VarianceCard({
  facility,
  variance,
  reportingCurrency,
  reportingMinorUnits,
}: {
  facility: FacilityBorrowing;
  variance: FacilityBorrowing["variance"];
  reportingCurrency: string;
  reportingMinorUnits: number | null;
}) {
  if (variance === null) {
    return (
      <Card className="min-w-0">
        <Card.Header className="p-5 pb-2">
          <Card.Title className="text-base font-medium">
            Modelled vs actual interest
          </Card.Title>
          <Card.Description className="text-sm text-muted">
            Year-to-date variance for this facility.
          </Card.Description>
        </Card.Header>
        <Card.Content className="p-5 pt-2">
          <UncertaintyNote title="Variance is not available">
            Modelled interest needs facility terms and a benchmark rate effective
            on or before the as-of date. Posted interest is still shown above.
          </UncertaintyNote>
        </Card.Content>
      </Card>
    );
  }

  const currency = facility.currency;
  const scale = facility.minorUnits;

  return (
    <Card className="min-w-0">
      <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-base font-medium">
            Modelled vs actual interest
          </Card.Title>
          <Card.Description className="text-sm text-muted">
            {variance.periodStart} → {variance.periodEnd} (half-open). Modelled
            accrual is an estimate from the benchmark curve and spread.
          </Card.Description>
        </div>
        <Chip size="sm" variant="soft" color="warning">
          Modelled is an estimate
        </Chip>
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-col gap-4 p-5 pt-2">
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Fact
            label="Modelled (estimate)"
            value={formatMoney(variance.modelledTotalMinor, currency, scale)}
          />
          <Fact
            label="Actual posted"
            value={formatMoney(variance.actualPostedMinor, currency, scale)}
          />
          <Fact
            label="Variance (modelled − actual)"
            value={formatMoney(variance.varianceMinor, currency, scale)}
          />
        </div>
        {facility.investmentInterestYtdMinor !== null ? (
          <>
            <Separator />
            <p className="text-sm text-muted">
              Of the{" "}
              {formatMoney(facility.interestChargedYtdMinor, currency, scale)}{" "}
              posted this year,{" "}
              {formatMoney(
                facility.investmentInterestYtdMinor,
                currency,
                scale,
              )}{" "}
              was attributed to investment use
              {reportingCurrency !== currency && reportingMinorUnits !== null
                ? ` (facility currency ${currency}; reporting ${reportingCurrency})`
                : ""}
              .
            </p>
          </>
        ) : null}
      </Card.Content>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shell / empty / helpers                                             */
/* ------------------------------------------------------------------ */

function Screen({
  currency,
  ledgerVersion,
  children,
}: {
  currency?: string | undefined;
  ledgerVersion: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Cost of borrowed capital</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Borrowing</h1>
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

function MethodNote() {
  return (
    <Card className="min-w-0">
      <Card.Header className="p-5 pb-2">
        <Card.Title className="text-base font-medium">
          How to read these figures
        </Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2 p-5 pt-2 text-sm text-muted">
        <p>
          Outstanding balances and use slices are derived by replaying posted
          journals — they are facts about the ledger, not estimates.
        </p>
        <p>
          <span className="text-foreground">Modelled interest</span> is an
          estimate from the facility&apos;s terms (spread, day-count) and the
          linked benchmark rate curve. It is never labelled as actual.
        </p>
        <p>
          <span className="text-foreground">Actual interest</span> is the sum
          of posted INTEREST_CHARGED journals in the year-to-date window. The
          variance is modelled minus actual.
        </p>
        <p>
          When facility terms or a usable benchmark rate are missing, the
          effective rate, modelled series, and variance stay unavailable rather
          than being filled with a guess.
        </p>
      </Card.Content>
    </Card>
  );
}

function NoFacilitiesState({
  message,
  hasAccounts,
}: {
  message?: string | undefined;
  hasAccounts: boolean;
}) {
  const { title, description } = noFacilitiesReason(message, hasAccounts);

  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:credit-card" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>{title}</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function noFacilitiesReason(
  message: string | undefined,
  hasAccounts: boolean,
): { title: string; description: string } {
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
          "Borrowing is scoped to a household, which comes from the session. Sign in to load it.",
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
          "This household has no accounts, so there is no credit facility to show borrowing for.",
      };
    default:
      if (hasAccounts) {
        return {
          title: "No credit facilities",
          description:
            "This household has accounts, but none of type CREDIT_FACILITY. " +
            "Add a credit facility account to track borrowed capital and interest.",
        };
      }
      return {
        title: "No credit facilities",
        description:
          "There are no CREDIT_FACILITY accounts to derive borrowing from.",
      };
  }
}
