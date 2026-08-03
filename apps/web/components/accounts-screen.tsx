"use client";

import { Card, Chip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import { formatMoney, signedTrend, type Trend } from "@/lib/format";
import {
  accountTone,
  isLiabilityType,
  sortBalanceRows,
} from "@/lib/accounts-table";
import type { BalanceRow, PortfolioSnapshot } from "@/lib/portfolio-shared";

/**
 * Account overview — one card per household account with the replay balance.
 *
 * Every balance comes off `snapshot.balances`. Liabilities
 * (`CREDIT_FACILITY`) are marked with the danger token so they read apart
 * from assets without inventing colours.
 */

const TREND_TONE: Record<Trend, string> = {
  up: "text-success",
  down: "text-danger",
  neutral: "text-foreground",
};

type AccountsScreenProps = {
  snapshot: PortfolioSnapshot;
};

export function AccountsScreen({ snapshot }: AccountsScreenProps) {
  const rows = sortBalanceRows(snapshot.balances);

  if (rows.length === 0) {
    return (
      <Screen currency={snapshot.reportingCurrency}>
        <NoAccountsState message={snapshot.message} />
      </Screen>
    );
  }

  return (
    <Screen currency={snapshot.reportingCurrency}>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <AccountCard key={row.accountId} row={row} />
        ))}
      </div>
    </Screen>
  );
}

function AccountCard({ row }: { row: BalanceRow }) {
  const liability = isLiabilityType(row.accountType);
  const tone = accountTone(row.accountType);
  const amountTone = TREND_TONE[signedTrend(row.minor)];

  return (
    <Card className="min-w-0">
      <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-base font-medium">
            {row.accountName}
          </Card.Title>
          <Card.Description className="text-sm text-muted">
            {row.accountType.replaceAll("_", " ")}
          </Card.Description>
        </div>
        <div className="flex flex-wrap gap-1">
          <Chip size="sm" variant="soft">
            {row.currency}
          </Chip>
          <Chip
            size="sm"
            variant="soft"
            color={tone === "danger" ? "danger" : "accent"}
          >
            {liability ? "Liability" : "Asset"}
          </Chip>
        </div>
      </Card.Header>
      <Card.Content className="px-5 pb-5">
        <p className={`text-2xl font-medium tabular-nums ${amountTone}`}>
          {formatMoney(row.minor, row.currency, row.minorUnits)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Replay balance — derived, never stored.
        </p>
      </Card.Content>
    </Card>
  );
}

function Screen({
  children,
  currency,
}: {
  children: React.ReactNode;
  currency: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-medium text-foreground">Accounts</h1>
          <p className="text-sm text-muted">
            Household accounts and their replayed balances.
          </p>
        </div>
        {currency ? (
          <Chip size="sm" variant="soft">
            {currency}
          </Chip>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function NoAccountsState({ message }: { message: string | undefined }) {
  const { title, description } = noAccountsReason(message);

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

function noAccountsReason(
  message: string | undefined,
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
          "Accounts are scoped to a household, which comes from the session. Sign in to load them.",
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
          "This household has no accounts. Add a cash or investment account to begin.",
      };
    default:
      return {
        title: "No accounts yet",
        description:
          "This household has no accounts to show. External counterpart balances are omitted on purpose.",
      };
  }
}
