"use client";

import { Card, Chip, Separator } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import {
  UNKNOWN,
  formatBps,
  formatMoney,
  formatQuantity,
  formatReportingMoney,
} from "@/lib/format";
import {
  compareMinor,
  compareNullableNumber,
  compareQuantity,
  positionQualifiers,
  sharedUncertaintyReasons,
} from "@/lib/positions-table";
import type { PortfolioSnapshot, PositionRow } from "@/lib/portfolio-shared";
import { UncertaintyNote } from "@/components/portfolio-charts";

/**
 * Per-position economics, including the cost of the borrowed capital that
 * financed each holding — the question this product exists to answer.
 *
 * Every figure comes off `PositionRow`; nothing is derived here. Where the
 * read model could not derive a figure it is `null`, and this screen renders
 * the `UNKNOWN` marker rather than a number that would read as fact — in
 * particular a position with an unknown cost basis shows the marker in every
 * column that depends on cost.
 *
 * Two distinctions the read model draws deliberately are carried through to
 * the labels here, because collapsing either would let a user read a figure as
 * something it is not:
 *
 * 1. **Gross and net are separate columns.** Net is the default figure to read;
 *    gross exists so the cost of borrowing is visible as the difference.
 * 2. **Net here is per holding**, after the interest and fees attributable to
 *    *that* holding. The portfolio headline on the overview is net of every
 *    cost, including fees that name no holding. `netReturnBps`'s own doc
 *    comment says so, and the column header and the method note repeat it.
 */

type PositionsScreenProps = {
  snapshot: PortfolioSnapshot;
};

/** Everything a cell needs that is not on the row itself. */
type RenderContext = {
  /** Reporting currency of the household. */
  currency: string;
  /** Its minor-unit scale, or `null` when unknown — see `formatReportingMoney`. */
  minorUnits: number | null;
  accountName: (accountId: string) => string;
};

export function PositionsScreen({ snapshot }: PositionsScreenProps) {
  const currency = snapshot.reportingCurrency ?? "CAD";
  const names = new Map(
    snapshot.balances.map((balance) => [balance.accountId, balance.accountName]),
  );
  const context: RenderContext = {
    currency,
    minorUnits: snapshot.reportingMinorUnits,
    accountName: (accountId) => names.get(accountId) ?? accountId,
  };

  if (snapshot.positions.length === 0) {
    return (
      <Screen currency={snapshot.reportingCurrency} ledgerVersion={snapshot.ledgerVersion}>
        <NoPositionsState message={snapshot.message} hasAccounts={snapshot.balances.length > 0} />
      </Screen>
    );
  }

  // A reason every holding carries is a portfolio-level fact stated per row;
  // it is shown once rather than under each symbol.
  const shared = sharedUncertaintyReasons(snapshot.positions);
  const qualified = snapshot.positions
    .map((row) => ({
      row,
      reasons: row.valuationUncertaintyReasons.filter(
        (reason) => !shared.includes(reason),
      ),
    }))
    .filter((entry) => entry.reasons.length > 0);

  return (
    <Screen currency={currency} ledgerVersion={snapshot.ledgerVersion}>
      <Card className="min-w-0">
        <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Card.Title className="text-base font-medium">Holdings</Card.Title>
            <Card.Description className="text-sm text-muted">
              {snapshot.positions.length === 1
                ? "1 open position"
                : `${snapshot.positions.length} open positions`}
              , derived by ledger replay. Net return is after the interest and
              fees attributed to that holding; gross is before both. Sort any
              column; the table scrolls sideways on a narrow screen.
            </Card.Description>
          </div>
          <Chip size="sm" variant="soft" color="accent">
            Returns since inception
          </Chip>
        </Card.Header>
        <Card.Content className="min-w-0 p-5 pt-0">
          <DataGrid<PositionRow>
            aria-label="Positions, with return before and after the cost of borrowing"
            data={snapshot.positions}
            columns={positionColumns(context)}
            getRowId={(row) => row.key}
            defaultSortDescriptor={{ column: "symbol", direction: "ascending" }}
            // Wide enough that no column is squeezed to nothing, and narrow
            // enough to fit the page container on a desktop; below that the
            // grid scrolls inside its own container rather than the page.
            contentClassName="min-w-[1140px]"
            verticalAlign="top"
          />
        </Card.Content>
      </Card>

      {shared.length > 0 || qualified.length > 0 ? (
        <QualifiedRows entries={qualified} shared={shared} />
      ) : null}

      <MethodNote currency={currency} pricedAsOf={snapshot.valuation.pricedAsOf} />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

/**
 * The grid's columns.
 *
 * Every comparator is explicit: the built-in fallback compares
 * `String(value)`, which orders minor-unit money and basis points as text
 * ("9" after "10") and treats `null` as the string "null". Money is compared
 * as `bigint` by `compareMinor`, so nothing here converts money to a `number`.
 */
function positionColumns(context: RenderContext): DataGridColumn<PositionRow>[] {
  return [
    {
      id: "symbol",
      header: "Holding",
      isRowHeader: true,
      allowsSorting: true,
      pinned: "start",
      width: 190,
      minWidth: 190,
      sortFn: (a, b) => a.symbol.localeCompare(b.symbol),
      cell: (row) => <HoldingCell row={row} context={context} />,
    },
    {
      id: "quantity",
      header: "Quantity",
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareQuantity(a.quantity, b.quantity),
      cell: (row) => <Figure>{formatQuantity(row.quantity)}</Figure>,
    },
    {
      id: "cost",
      header: "Cost basis",
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareMinor(a.costReportingMinor, b.costReportingMinor),
      cell: (row) => (
        <Money
          // An unknown cost is `null`, never `"0"` — read the flag as well as
          // the amount, so a zero-cost gift and an unrecorded cost never render
          // the same way.
          minor={row.costIsUnknown ? null : row.costReportingMinor}
          context={context}
          absentTitle={`No cost basis is recorded for ${row.symbol}.`}
        />
      ),
    },
    {
      id: "marketValue",
      header: "Market value",
      align: "end",
      allowsSorting: true,
      // Wide enough that the mark's date does not wrap mid-date.
      minWidth: 210,
      sortFn: (a, b) => compareMinor(a.marketValueMinor, b.marketValueMinor),
      cell: (row) => <MarketValueCell row={row} context={context} />,
    },
    {
      id: "unrealized",
      header: "Unrealized gain",
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareMinor(a.unrealizedGainMinor, b.unrealizedGainMinor),
      cell: (row) => (
        <Money
          minor={row.unrealizedGainMinor}
          context={context}
          signed
          absentTitle={`Market value or cost basis is not derivable for ${row.symbol}.`}
        />
      ),
    },
    {
      id: "grossReturn",
      header: <ColumnHeader label="Gross return" note="before costs" />,
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareNullableNumber(a.grossReturnBps, b.grossReturnBps),
      cell: (row) => (
        <Return
          bps={row.grossReturnBps}
          absentTitle={`A gross return needs both a market value and a cost basis for ${row.symbol}.`}
        />
      ),
    },
    {
      id: "interest",
      header: <ColumnHeader label="Interest cost" note="attributed to this holding" />,
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareMinor(a.interestCostMinor, b.interestCostMinor),
      cell: (row) => (
        <Money
          minor={row.interestCostMinor}
          context={context}
          absentTitle={`How much borrowing cost financed ${row.symbol} is not derivable.`}
        />
      ),
    },
    {
      id: "fees",
      header: <ColumnHeader label="Fees" note="this holding only" />,
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareMinor(a.feeCostMinor, b.feeCostMinor),
      cell: (row) => (
        <Money
          minor={row.feeCostMinor}
          context={context}
          absentTitle={`A fee charged against ${row.symbol} could not be stated in ${context.currency}.`}
        />
      ),
    },
    {
      id: "netReturn",
      header: <ColumnHeader label="Net return" note="after this holding's costs" />,
      align: "end",
      allowsSorting: true,
      sortFn: (a, b) => compareNullableNumber(a.netReturnBps, b.netReturnBps),
      cell: (row) => (
        <Return
          bps={row.netReturnBps}
          absentTitle={`A net return needs the gross return plus the costs attributed to ${row.symbol}.`}
        />
      ),
    },
  ];
}

/**
 * A column header with the qualifier its figure needs to be read correctly.
 *
 * The qualifier belongs in the header rather than only in the note below the
 * table: a reader scanning the net column must not have to scroll to learn
 * that it is net of this holding's costs and not of the portfolio's.
 */
function ColumnHeader({ label, note }: { label: string; note: string }) {
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      <span className="text-xs font-normal text-muted">{note}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Cells                                                               */
/* ------------------------------------------------------------------ */

/**
 * The holding, its account, and the qualifiers that apply to its row.
 *
 * The two chips are not interchangeable. "As of <date>" says the figures are
 * real but older than today; "Incomplete" says a figure is missing. A stale
 * row is never called incomplete, and a row can carry both.
 */
function HoldingCell({ row, context }: { row: PositionRow; context: RenderContext }) {
  const { isStale, isIncomplete } = positionQualifiers(row);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium text-foreground">{row.symbol}</span>
      <span className="truncate text-xs text-muted">
        {context.accountName(row.accountId)}
      </span>
      {isStale || isIncomplete ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {isStale ? (
            <Chip size="sm" variant="soft" color="warning">
              As of {row.priceAsOf ?? UNKNOWN}
            </Chip>
          ) : null}
          {isIncomplete ? (
            <Chip size="sm" variant="soft" color="danger">
              Incomplete
            </Chip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Market value in the reporting currency, over the mark it was struck from.
 *
 * The sub-line is the provenance of the number above it: an unpriced holding
 * says it is carried at cost rather than showing a value, and a holding priced
 * in a currency with no rate shows the value it *does* have, in the price's own
 * currency, instead of an unqualified blank.
 */
function MarketValueCell({ row, context }: { row: PositionRow; context: RenderContext }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Money
        minor={row.marketValueMinor}
        context={context}
        absentTitle={`No ${context.currency} market value is derivable for ${row.symbol}.`}
      />
      {markLines(row, context).map((line) => (
        <span key={line} className="text-xs text-muted">
          {line}
        </span>
      ))}
    </div>
  );
}

/**
 * Where the value above came from: the value the holding *does* have when the
 * reporting figure is absent, then the mark it was struck from and its date.
 */
function markLines(row: PositionRow, context: RenderContext): string[] {
  if (row.priceSource === "NONE" || row.priceMinor === null || row.priceCurrency === null) {
    return ["No price — carried at cost"];
  }

  const scale = row.priceMinorUnits ?? 2;
  // A quote is the ordinary case and needs no label; a manual mark is not, and
  // saying so is the difference between a market price and someone's opinion.
  const source = row.priceSource === "OVERRIDE" ? "manual mark · " : "";
  const dated = `${formatMoney(row.priceMinor, row.priceCurrency, scale)}/unit · ${source}${row.priceAsOf ?? UNKNOWN}`;

  if (row.marketValueMinor === null && row.marketValueTradeMinor !== null) {
    const traded = formatMoney(row.marketValueTradeMinor, row.priceCurrency, scale);
    return [`${traded} · no rate into ${context.currency}`, dated];
  }

  return [dated];
}

/**
 * A reporting-currency amount, or the `UNKNOWN` marker with the reason on
 * hover. `formatReportingMoney` already refuses to place a decimal point at a
 * guessed scale, so an unknown scale reaches the same marker.
 */
function Money({
  minor,
  context,
  signed = false,
  absentTitle,
}: {
  minor: string | null;
  context: RenderContext;
  /** Colour the amount by its sign. Only for figures where a sign is meaningful. */
  signed?: boolean;
  absentTitle: string;
}) {
  if (minor === null) {
    return <Absent title={absentTitle} />;
  }

  const tone = signed ? signTone(minor) : "text-foreground";
  return (
    <Figure className={tone}>
      {formatReportingMoney(minor, context.currency, context.minorUnits)}
    </Figure>
  );
}

/** A return in basis points, coloured by sign. Never a money value. */
function Return({ bps, absentTitle }: { bps: number | null; absentTitle: string }) {
  if (bps === null) {
    return <Absent title={absentTitle} />;
  }

  const tone = bps > 0 ? "text-success" : bps < 0 ? "text-danger" : "text-foreground";
  return <Figure className={tone}>{formatBps(bps)}</Figure>;
}

/** Sign of a minor-unit string, without converting it to a number. */
function signTone(minor: string): string {
  if (minor.startsWith("-")) return "text-danger";
  return /[1-9]/.test(minor) ? "text-success" : "text-foreground";
}

function Figure({
  className = "text-foreground",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`tabular-nums ${className}`}>{children}</span>;
}

/** The marker for a figure the read model would not derive. Never a `0`. */
function Absent({ title }: { title: string }) {
  return (
    <span className="tabular-nums text-muted" title={title}>
      {UNKNOWN}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

/**
 * How to read the table.
 *
 * Each line closes a gap between what a column *looks* like and what it is:
 * the returns are inception-to-date rather than annual, net here is narrower
 * than the portfolio headline, and a cost the ledger deliberately does not
 * attribute is named rather than left as a silent omission from every net
 * figure in the table.
 */
function MethodNote({
  currency,
  pricedAsOf,
}: {
  currency: string;
  pricedAsOf: string | null;
}) {
  return (
    <Card className="min-w-0">
      <Card.Content className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">How to read these figures</h2>
          <Chip size="sm" variant="soft">
            {currency}
          </Chip>
          {pricedAsOf ? (
            <Chip size="sm" variant="soft">
              Priced as of {pricedAsOf}
            </Chip>
          ) : (
            <Chip size="sm" variant="soft" color="warning">
              No prices resolved
            </Chip>
          )}
        </div>
        <Separator />
        <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted">
          <li>
            <span className="text-foreground">Gross return</span> is the gain on
            cost before any cost of carry.{" "}
            <span className="text-foreground">Net return</span> is that gain
            after the interest and fees attributed to that holding — the
            difference between the two columns is what the borrowing cost.
          </li>
          <li>
            Net return here is <span className="text-foreground">per holding</span>.
            A fee that names no holding cannot honestly be split across
            holdings, so it is excluded from every net figure in this table and
            counted only in the portfolio return on the overview, which is the
            figure net of every cost.
          </li>
          <li>
            Fees charged on a credit facility are{" "}
            <span className="text-foreground">not</span> counted as an
            investment cost anywhere, here or on the overview: the ledger
            records no use attribution for them, and the interest rule already
            refuses to guess at investment use without one. Where such a fee
            exists, every net figure understates the cost of the borrowing.
          </li>
          <li>
            Both returns are{" "}
            <span className="text-foreground">since inception, not annualized</span>{" "}
            and not time-weighted. A holding up 10% over ten years and one up
            10% over ten weeks read identically here.
          </li>
          <li>
            Cost basis is pooled ACB in {currency}. An unknown cost is{" "}
            <span className="text-foreground">{UNKNOWN}</span>, never zero, and
            every figure derived from it is {UNKNOWN} too.
          </li>
        </ul>
      </Card.Content>
    </Card>
  );
}

/**
 * The read model's own reasons, per row, under the heading its qualifiers
 * warrant.
 *
 * `PositionRow.valuationUncertaintyReasons` mixes staleness and
 * incompleteness — a row marked at Friday's close is qualified even when the
 * portfolio total it feeds is whole — so the heading is built from the two
 * booleans and the reasons themselves are shown verbatim.
 */
function QualifiedRows({
  entries,
  shared,
}: {
  entries: readonly { row: PositionRow; reasons: readonly string[] }[];
  shared: readonly string[];
}) {
  const anyIncomplete = entries.some(
    (entry) => positionQualifiers(entry.row).isIncomplete,
  );

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-medium">What qualifies these figures</h2>
      <UncertaintyNote
        status={anyIncomplete ? "warning" : "accent"}
        title={
          anyIncomplete
            ? "Some figures could not be derived"
            : "Some holdings are marked at an earlier date"
        }
      >
        Each reason below is the read model&apos;s own, naming what is missing
        or how old the mark is. A holding marked at an earlier date is not
        incomplete: its figures are real, as of that date.
      </UncertaintyNote>

      {shared.length > 0 ? (
        <Card className="min-w-0">
          <Card.Content className="flex flex-col gap-2 p-5">
            <span className="font-medium text-foreground">Applies to every holding</span>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted">
              {shared.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        {entries.map(({ row, reasons }) => {
          const { isStale, isIncomplete } = positionQualifiers(row);
          return (
            <Card key={row.key} className="min-w-0">
              <Card.Content className="flex flex-col gap-2 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{row.symbol}</span>
                  {isStale ? (
                    <Chip size="sm" variant="soft" color="warning">
                      Marked {row.priceAsOf ?? UNKNOWN}
                    </Chip>
                  ) : null}
                  {isIncomplete ? (
                    <Chip size="sm" variant="soft" color="danger">
                      Incomplete
                    </Chip>
                  ) : null}
                </div>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted">
                  {reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </Card.Content>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** The page frame, matching the overview's. */
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
    // Wider than the overview's `max-w-6xl`: this screen is a nine-column
    // table, and the extra width is what lets it be read without scrolling on
    // a desktop.
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Per-holding economics</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Positions</h1>
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

/**
 * No positions, stating the reason the read model gave. A household with
 * accounts and journals but no holdings is a different fact from one with no
 * database configured, and each branch names something the user can act on.
 */
function NoPositionsState({
  message,
  hasAccounts,
}: {
  message: string | undefined;
  hasAccounts: boolean;
}) {
  const { title, description } = noPositionsReason(message, hasAccounts);

  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:chart-column" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>{title}</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function noPositionsReason(
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
          "Positions are scoped to a household, which comes from the session. Sign in to load them.",
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
          "The household has no accounts, so there is nothing to replay. Create an account, then post a buy.",
      };
    default:
      return {
        title: "No open positions",
        description: hasAccounts
          ? "Replay produced no holdings: either nothing has been bought, or everything bought has since been sold in full."
          : (message ??
            "The household has accounts but no posted journals, so replay produces no holdings. Post a buy to see it here."),
      };
  }
}
