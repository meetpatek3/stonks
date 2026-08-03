"use client";

import { Card, Chip } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import Link from "next/link";
import type { OpenItem, OpenItemCounts, PortfolioSnapshot } from "@/lib/portfolio-shared";
import {
  groupOpenItemsBySeverity,
  openItemRefHref,
  openItemRowId,
  openItemSeverityTone,
  type OpenItemSeverityGroup,
} from "@/lib/open-items-table";

/**
 * Data-quality dashboard — every finding is from `snapshot.openItems`.
 *
 * The total in the header is `openItemCounts.total` from the same snapshot the
 * sidebar badge reads. An empty list is a good outcome ("nothing needs
 * attention"), not a load failure — those failure modes still name the real
 * reason via `snapshot.message`.
 */

type OpenItemsScreenProps = {
  snapshot: PortfolioSnapshot;
};

export function OpenItemsScreen({ snapshot }: OpenItemsScreenProps) {
  const items = snapshot.openItems;
  const counts = snapshot.openItemCounts;
  const hasFailure = Boolean(snapshot.message);

  // Only a missing snapshot is an empty-state failure. A loaded household
  // with zero findings is healthy and gets its own wording below.
  if (hasFailure && items.length === 0 && counts.total === 0) {
    return (
      <Screen counts={counts}>
        <LoadFailureState message={snapshot.message} />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen counts={counts}>
        <AllClearState />
      </Screen>
    );
  }

  const groups = groupOpenItemsBySeverity(items);

  return (
    <Screen counts={counts}>
      <CountSummary counts={counts} />
      {groups.map((group) => (
        <SeveritySection key={group.severity} group={group} />
      ))}
      <MethodNote />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Counts — same source as the sidebar badge                           */
/* ------------------------------------------------------------------ */

function CountSummary({ counts }: { counts: OpenItemCounts }) {
  return (
    <Card className="min-w-0">
      <Card.Content className="flex flex-wrap gap-3 p-5">
        <CountChip
          label="Total"
          value={counts.total}
          tone={counts.total > 0 ? "warning" : "accent"}
        />
        <CountChip label="Unknown cost" value={counts.unknownCost} />
        <CountChip label="Missing FX rate" value={counts.missingFxRate} />
        <CountChip label="Zero cost basis" value={counts.zeroCostBasis} />
      </Card.Content>
    </Card>
  );
}

function CountChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "accent";
}) {
  return (
    <Chip size="md" variant="soft" color={tone}>
      {label}: {value}
    </Chip>
  );
}

/* ------------------------------------------------------------------ */
/* Severity sections                                                   */
/* ------------------------------------------------------------------ */

function SeveritySection({ group }: { group: OpenItemSeverityGroup }) {
  const tone = openItemSeverityTone(group.severity);

  return (
    <Card className="min-w-0">
      <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-base font-medium">
              {severityTitle(group.severity)}
            </Card.Title>
            <Chip size="sm" variant="soft" color={tone}>
              {group.items.length}
            </Chip>
          </div>
          <Card.Description className="text-sm text-muted">
            {severityDescription(group.severity)}
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="min-w-0 p-5 pt-0">
        <DataGrid<OpenItem>
          aria-label={`${group.severity} open items`}
          data={group.items}
          columns={columns()}
          getRowId={openItemRowId}
          contentClassName="min-w-[720px]"
          verticalAlign="top"
        />
      </Card.Content>
    </Card>
  );
}

function severityTitle(severity: OpenItemSeverityGroup["severity"]): string {
  switch (severity) {
    case "ERROR":
      return "Errors";
    case "WARNING":
      return "Warnings";
    case "INFO":
      return "Informational";
  }
}

function severityDescription(severity: OpenItemSeverityGroup["severity"]): string {
  switch (severity) {
    case "ERROR":
      return "Findings that block a derived figure until the underlying data is fixed.";
    case "WARNING":
      return "Gaps that leave a total incomplete or a sale without a computable gain.";
    case "INFO":
      return "Notable facts that are not data errors — for example a true zero-cost lot.";
  }
}

function columns(): DataGridColumn<OpenItem>[] {
  return [
    {
      id: "kind",
      header: "Kind",
      isRowHeader: true,
      accessorKey: "kind",
      allowsSorting: true,
      width: 200,
      pinned: "start",
      minWidth: 160,
      cell: (row) => (
        <Chip size="sm" variant="soft" color={openItemSeverityTone(row.severity)}>
          {row.kind.replaceAll("_", " ")}
        </Chip>
      ),
    },
    {
      id: "message",
      header: "Message",
      accessorKey: "message",
      allowsSorting: true,
      minWidth: 280,
      cell: (row) => (
        <p className="whitespace-normal text-sm text-foreground">{row.message}</p>
      ),
    },
    {
      id: "ref",
      header: "Reference",
      allowsSorting: true,
      sortFn: (a, b) =>
        `${a.refType}:${a.refId}`.localeCompare(`${b.refType}:${b.refId}`),
      width: 220,
      minWidth: 180,
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-1">
          <Chip size="sm" variant="soft">
            {row.refType}
          </Chip>
          <Link
            href={openItemRefHref(row.refType, row.refId)}
            className="truncate text-sm text-accent underline-offset-2 hover:underline"
          >
            {row.refId}
          </Link>
        </div>
      ),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Shell / empty states                                                */
/* ------------------------------------------------------------------ */

function Screen({
  children,
  counts,
}: {
  children: React.ReactNode;
  counts: OpenItemCounts;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Data quality</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Open items</h1>
          <Chip
            variant="soft"
            color={counts.total > 0 ? "warning" : "accent"}
          >
            {counts.total === 1 ? "1 open item" : `${counts.total} open items`}
          </Chip>
        </div>
      </header>
      {children}
    </div>
  );
}

function AllClearState() {
  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:circle-check" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>Nothing needs attention</EmptyState.Title>
            <EmptyState.Description>
              Every holding has a known cost basis, every balance converts into
              the reporting currency, and there are no informational
              zero-cost flags. The open-items badge is clear.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function LoadFailureState({ message }: { message: string | undefined }) {
  const { title, description } = loadFailureReason(message);

  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:triangle-exclamation" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>{title}</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function loadFailureReason(message: string | undefined): {
  title: string;
  description: string;
} {
  switch (message) {
    case "DATABASE_URL not configured":
      return {
        title: "No database configured",
        description:
          "DATABASE_URL is not set, so there is no ledger to inspect for data-quality findings. Set it and restart the app.",
      };
    case "not authenticated":
      return {
        title: "Not signed in",
        description:
          "Open items are scoped to a household, which comes from the session. Sign in to load them.",
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
          "The household has no accounts, so there is nothing to inspect. Create an account, then post a journal.",
      };
    default:
      return {
        title: "Unable to load open items",
        description:
          message ??
          "The read model could not produce a snapshot, so open items are unavailable.",
      };
  }
}

function MethodNote() {
  return (
    <Card className="min-w-0">
      <Card.Content className="flex flex-col gap-2 p-5 text-sm text-muted">
        <p className="font-medium text-foreground">What counts as an open item</p>
        <p>
          Only findings derivable from posted journals and account metadata
          appear here: unknown cost basis, a recorded zero cost, and a balance
          that cannot be converted into the reporting currency. Interest
          variance lives on the borrowing screen; statement reconciliation is
          not invented without imported statements.
        </p>
        <p>
          Each row traces to a position, account, or journal. The total matches
          the sidebar badge because both read the same snapshot&apos;s
          open-item count — nothing is counted a second time on this page.
        </p>
      </Card.Content>
    </Card>
  );
}
