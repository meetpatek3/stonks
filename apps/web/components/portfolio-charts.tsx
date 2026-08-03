"use client";

import { Alert, Card, Chip } from "@heroui/react";
import { AreaChart } from "@heroui-pro/react/area-chart";
import { ChartTooltip } from "@heroui-pro/react/chart-tooltip";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { PieChart } from "@heroui-pro/react/pie-chart";
import { Icon } from "@iconify/react";
import {
  formatBps,
  formatCompactNumber,
  formatMoney,
  minorToDisplayNumber,
} from "@/lib/format";
import type { AllocationBasis, AllocationRow, ValuePoint } from "@/lib/portfolio-shared";

/**
 * The portfolio's chart surface, shared by the overview and `/charts`.
 *
 * Both screens render the same two components so an allocation pie means the
 * same thing in both places. Everything here is built from HeroUI Pro's
 * `AreaChart` / `PieChart` / `ChartTooltip` — no custom Recharts wrappers —
 * and every series colour is a `--chart-*` token.
 *
 * Money crosses into these components as minor-unit strings, exactly as the
 * snapshot carries it, and becomes a `number` only at the leaf via
 * `minorToDisplayNumber`, which is display-only. The tooltips read the
 * original minor string back off the datum, so the figure a user reads is
 * formatted from the ledger value rather than from the plotted float.
 */

/** The five series tokens the Pro theme ships, cycled across categories. */
const CHART_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

function chartToken(index: number): string {
  return CHART_TOKENS[index % CHART_TOKENS.length] as string;
}

/** The single series colour for a one-series chart. */
const SERIES_TOKEN = "var(--chart-3)";

type MoneyContext = {
  currency: string;
  minorUnits: number;
};

/**
 * A short, tokenised note attached to a figure the read model marked
 * uncertain. Rendered wherever the affected figure is shown — the flags exist
 * because the read model refuses to guess, so hiding one would undo that.
 */
export function UncertaintyNote({
  status = "warning",
  title,
  children,
}: {
  status?: "accent" | "warning" | "danger";
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Alert status={status}>
      <Alert.Indicator>
        <Icon icon="gravity-ui:circle-info" width={16} />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children ? <Alert.Description>{children}</Alert.Description> : null}
      </Alert.Content>
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/* Value over time                                                     */
/* ------------------------------------------------------------------ */

/**
 * A chart datum. `AreaChart` types its `data` as
 * `Record<string, number | string>`, so `ValuePoint.isUncertain` is carried as
 * a 0/1 flag rather than a boolean — the only reason this is not simply the
 * `ValuePoint` itself.
 */
type ValueDatum = {
  month: string;
  /** Display-only float, for plotting. */
  value: number;
  /** The ledger figure, kept so the tooltip formats from it. */
  minor: string;
  uncertain: 0 | 1;
};

function toValueData(points: readonly ValuePoint[], minorUnits: number): ValueDatum[] {
  return points.map((point) => ({
    month: point.month,
    value: minorToDisplayNumber(point.valueMinor, minorUnits),
    minor: point.valueMinor,
    uncertain: point.isUncertain ? (1 as const) : (0 as const),
  }));
}

/**
 * Month-end net worth as a Pro `AreaChart`.
 *
 * Wide series scroll inside the chart's own container rather than pushing the
 * page sideways: each month is given a minimum slot so twelve months on a
 * 375px screen stay legible.
 */
export function ValueOverTimeChart({
  points,
  currency,
  minorUnits,
  height = 260,
}: MoneyContext & {
  points: readonly ValuePoint[];
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <ChartEmpty
        title="No value history yet"
        description="Month-end value is replayed from posted journals. Post a journal and a point appears for its month."
      />
    );
  }

  const data = toValueData(points, minorUnits);
  const minWidth = Math.max(280, data.length * 56);

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth }}>
        <AreaChart data={data} height={height}>
          <AreaChart.Grid strokeDasharray="3 3" vertical={false} />
          <AreaChart.XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <AreaChart.YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatCompactNumber(value)}
          />
          <AreaChart.Tooltip
            content={<ValueTooltip currency={currency} minorUnits={minorUnits} />}
          />
          <AreaChart.Area
            type="monotone"
            dataKey="value"
            name="Net worth"
            stroke={SERIES_TOKEN}
            fill={SERIES_TOKEN}
            fillOpacity={0.18}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </div>
    </div>
  );
}

type TooltipInjectedProps = {
  active?: boolean;
  label?: number | string;
  payload?: { payload?: unknown }[];
};

function ValueTooltip({
  active,
  label,
  payload,
  currency,
  minorUnits,
}: TooltipInjectedProps & MoneyContext) {
  const datum = payload?.[0]?.payload as ValueDatum | undefined;
  if (!active || !datum) return null;

  return (
    <ChartTooltip active>
      <ChartTooltip.Header>{String(label ?? datum.month)}</ChartTooltip.Header>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={SERIES_TOKEN} />
        <ChartTooltip.Label>Net worth</ChartTooltip.Label>
        <ChartTooltip.Value>
          {formatMoney(datum.minor, currency, minorUnits)}
        </ChartTooltip.Value>
      </ChartTooltip.Item>
      {datum.uncertain === 1 ? (
        <ChartTooltip.Item>
          <ChartTooltip.Label>
            Excludes a balance with no FX rate
          </ChartTooltip.Label>
        </ChartTooltip.Item>
      ) : null}
    </ChartTooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Allocation                                                          */
/* ------------------------------------------------------------------ */

/**
 * One slice of a cost-based split.
 *
 * `AllocationRow` is per position; `/charts` also groups those rows by
 * account, so the chart takes this reduced shape rather than the row itself.
 */
export type AllocationSlice = {
  key: string;
  label: string;
  /** Integer basis points; the slices of one chart sum to 10000. */
  bps: number;
  /** ACB cost in the reporting currency, minor units. */
  costReportingMinor: string;
};

/** Largest share first, so the arcs and the legend read in the same order. */
export function toAllocationSlices(
  rows: readonly AllocationRow[],
): AllocationSlice[] {
  return rows
    .map((row) => ({
      key: row.key,
      label: row.symbol,
      bps: row.bps,
      costReportingMinor: row.costReportingMinor,
    }))
    .sort((a, b) => b.bps - a.bps);
}

/**
 * Group per-position allocation into one slice per account.
 *
 * Basis points are summed rather than recomputed, so the grouped slices still
 * sum to exactly 10000 — no second rounding pass, no drift against the
 * ungrouped chart.
 */
export function groupAllocationByAccount(
  rows: readonly AllocationRow[],
  accountName: (accountId: string) => string,
): AllocationSlice[] {
  const byAccount = new Map<string, AllocationSlice>();

  for (const row of rows) {
    const existing = byAccount.get(row.accountId);
    if (existing) {
      existing.bps += row.bps;
      existing.costReportingMinor = (
        BigInt(existing.costReportingMinor) + BigInt(row.costReportingMinor)
      ).toString();
      continue;
    }
    byAccount.set(row.accountId, {
      key: row.accountId,
      label: accountName(row.accountId),
      bps: row.bps,
      costReportingMinor: row.costReportingMinor,
    });
  }

  return [...byAccount.values()].sort((a, b) => b.bps - a.bps);
}

type AllocationDatum = AllocationSlice & {
  /** Display-only float, for the arc angles. */
  value: number;
  token: string;
};

/**
 * Allocation as a Pro `PieChart`.
 *
 * The split is of **cost**, never market value — `allocationBasis` says so and
 * the caller is expected to label it. The arcs are drawn from basis points
 * directly, so no money value becomes a number to draw this chart at all.
 */
export function AllocationPieChart({
  slices,
  currency,
  minorUnits,
  height = 260,
}: MoneyContext & {
  slices: readonly AllocationSlice[];
  height?: number;
}) {
  if (slices.length === 0) {
    return (
      <ChartEmpty
        title="Nothing to allocate"
        description="A cost-based split needs at least one position with a known, positive cost basis."
      />
    );
  }

  const data: AllocationDatum[] = slices.map((slice, index) => ({
    ...slice,
    value: slice.bps,
    token: chartToken(index),
  }));

  return (
    <div className="flex flex-col gap-4">
      <PieChart height={height}>
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
          content={<AllocationTooltip currency={currency} minorUnits={minorUnits} />}
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
            <span className="tabular-nums text-muted">{formatBps(datum.bps)}</span>
            <span className="tabular-nums text-foreground">
              {formatMoney(datum.costReportingMinor, currency, minorUnits)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AllocationTooltip({
  active,
  payload,
  currency,
  minorUnits,
}: TooltipInjectedProps & MoneyContext) {
  const datum = payload?.[0]?.payload as AllocationDatum | undefined;
  if (!active || !datum) return null;

  return (
    <ChartTooltip active>
      <ChartTooltip.Header>{datum.label}</ChartTooltip.Header>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={datum.token} />
        <ChartTooltip.Label>Share of cost</ChartTooltip.Label>
        <ChartTooltip.Value>{formatBps(datum.bps)}</ChartTooltip.Value>
      </ChartTooltip.Item>
      <ChartTooltip.Item>
        <ChartTooltip.Label>Cost basis</ChartTooltip.Label>
        <ChartTooltip.Value>
          {formatMoney(datum.costReportingMinor, currency, minorUnits)}
        </ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}

/**
 * The label an allocation chart must carry.
 *
 * `allocationBasis` is `"COST"` because no price source is wired in. Calling
 * the split plain "allocation" would read as a market-value split, which the
 * ledger cannot support, so the basis is stated next to every such chart.
 */
export function AllocationBasisChip({ basis }: { basis: AllocationBasis }) {
  return (
    <Chip size="sm" variant="soft" color="warning">
      {basis === "COST" ? "Cost basis, not market value" : basis}
    </Chip>
  );
}

/* ------------------------------------------------------------------ */

/** A chart with no series is a fact about the ledger, not a blank box. */
function ChartEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <EmptyState size="sm">
      <EmptyState.Header>
        <EmptyState.Media variant="icon">
          <Icon icon="gravity-ui:chart-line" width={20} />
        </EmptyState.Media>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Header>
    </EmptyState>
  );
}

/** A titled panel around a chart, shared by both screens. */
export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-0">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-base font-medium">{title}</Card.Title>
          {description ? (
            <Card.Description className="text-sm text-muted">
              {description}
            </Card.Description>
          ) : null}
        </div>
        {action}
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-col gap-4 p-5">
        {children}
      </Card.Content>
    </Card>
  );
}
