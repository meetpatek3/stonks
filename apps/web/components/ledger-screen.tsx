"use client";

import { Card, Chip, Label, ListBox, Select, Separator } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";
import type { JournalType } from "@stonks/ledger";
import {
  UNKNOWN,
  formatMoney,
  signedTrend,
  type Trend,
} from "@/lib/format";
import { compareMinor } from "@/lib/positions-table";
import {
  filterJournalRows,
  type AccountRef,
  type JournalRow,
} from "@/lib/ledger-table";

/**
 * Transaction history — every journal including SUPERSEDED corrections.
 *
 * Rows arrive already projected (`toJournalRows`); this screen only filters
 * and renders. Nothing is derived here, and superseded journals are never
 * hidden — corrections use supersession, so the audit trail stays visible.
 */

const JOURNAL_TYPES: JournalType[] = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST_CHARGED",
  "INTEREST_EARNED",
  "FEE",
  "TRANSFER",
  "DEPOSIT",
  "WITHDRAWAL",
  "CORPORATE_ACTION",
  "OPENING",
];

const TREND_TONE: Record<Trend, string> = {
  up: "text-success",
  down: "text-danger",
  neutral: "text-foreground",
};

type LedgerScreenProps = {
  rows: JournalRow[];
  accounts: AccountRef[];
  message?: string | undefined;
};

export function LedgerScreen({ rows, accounts, message }: LedgerScreenProps) {
  const [typeFilter, setTypeFilter] = useState<JournalType | "ALL">("ALL");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");

  const filterAccounts = useMemo(
    () => accounts.filter((a) => a.type !== "EXTERNAL"),
    [accounts],
  );

  const visible = useMemo(
    () =>
      filterJournalRows(rows, {
        type: typeFilter,
        accountId: accountFilter,
      }),
    [rows, typeFilter, accountFilter],
  );

  if (rows.length === 0) {
    return (
      <Screen>
        <NoJournalsState message={message} hasAccounts={accounts.length > 0} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card className="min-w-0">
        <Card.Header className="flex flex-col gap-4 p-5 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Card.Title className="text-base font-medium">Transactions</Card.Title>
            <Card.Description className="text-sm text-muted">
              Posted journals in trade-date order, including superseded
              corrections. Balances still come only from posted journals.
            </Card.Description>
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <Select
              className="w-full sm:max-w-xs"
              selectedKey={typeFilter}
              onSelectionChange={(key) => {
                if (key == null) return;
                setTypeFilter(String(key) as JournalType | "ALL");
              }}
              aria-label="Filter by journal type"
            >
              <Label>Type</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="ALL" textValue="All types">
                    All types
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {JOURNAL_TYPES.map((type) => (
                    <ListBox.Item key={type} id={type} textValue={type}>
                      {type.replaceAll("_", " ")}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              className="w-full sm:max-w-xs"
              selectedKey={accountFilter}
              onSelectionChange={(key) => {
                if (key == null) return;
                setAccountFilter(String(key));
              }}
              aria-label="Filter by account"
            >
              <Label>Account</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="ALL" textValue="All accounts">
                    All accounts
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {filterAccounts.map((account) => (
                    <ListBox.Item
                      key={account.id}
                      id={account.id}
                      textValue={account.name}
                    >
                      {account.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </Card.Header>

        <Separator />

        <Card.Content className="min-w-0 p-0">
          {visible.length === 0 ? (
            <div className="p-8">
              <EmptyState>
                <EmptyState.Header>
                  <EmptyState.Media variant="icon">
                    <Icon icon="gravity-ui:magnifier" width={24} />
                  </EmptyState.Media>
                  <EmptyState.Title>No matching journals</EmptyState.Title>
                  <EmptyState.Description>
                    Nothing in the ledger matches the type and account filters.
                    Clear a filter to widen the list.
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            </div>
          ) : (
            <DataGrid<JournalRow>
              aria-label="Transaction history"
              data={visible}
              columns={columns()}
              getRowId={(row) => row.id}
              defaultSortDescriptor={{
                column: "tradeDate",
                direction: "descending",
              }}
              contentClassName="min-w-[880px]"
              verticalAlign="top"
            />
          )}
        </Card.Content>
      </Card>

      <MethodNote />
    </Screen>
  );
}

function columns(): DataGridColumn<JournalRow>[] {
  return [
    {
      id: "tradeDate",
      header: "Date",
      isRowHeader: true,
      allowsSorting: true,
      pinned: "start",
      width: 120,
      sortFn: (a, b) => {
        if (a.tradeDate !== b.tradeDate) {
          return a.tradeDate < b.tradeDate ? -1 : 1;
        }
        return a.sortKey - b.sortKey;
      },
      cell: (row) => (
        <span className="tabular-nums text-foreground">{row.tradeDate}</span>
      ),
    },
    {
      id: "type",
      header: "Type",
      allowsSorting: true,
      minWidth: 140,
      sortFn: (a, b) => a.type.localeCompare(b.type),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-foreground">{row.type.replaceAll("_", " ")}</span>
          {row.status === "SUPERSEDED" ? (
            <Chip size="sm" variant="soft" color="warning">
              Superseded
            </Chip>
          ) : null}
          {row.supersedesJournalId ? (
            <span className="text-xs text-muted" title={row.supersedesJournalId}>
              Corrects {shortId(row.supersedesJournalId)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "accounts",
      header: "Accounts",
      allowsSorting: true,
      minWidth: 200,
      sortFn: (a, b) => a.accountLabel.localeCompare(b.accountLabel),
      cell: (row) => (
        <span className="text-foreground">{row.accountLabel}</span>
      ),
    },
    {
      id: "memo",
      header: "Memo",
      allowsSorting: true,
      minWidth: 180,
      sortFn: (a, b) => (a.memo ?? "").localeCompare(b.memo ?? ""),
      cell: (row) => (
        <span className="text-muted">{row.memo ?? "—"}</span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "end",
      allowsSorting: true,
      minWidth: 140,
      sortFn: (a, b) => compareMinor(a.signedAmountMinor, b.signedAmountMinor),
      cell: (row) => <AmountCell row={row} />,
    },
  ];
}

function AmountCell({ row }: { row: JournalRow }) {
  if (row.signedAmountMinor === null) {
    return (
      <span
        className="tabular-nums text-muted"
        title="This journal has no postings, so no amount can be stated."
      >
        {UNKNOWN}
        <span className="sr-only">
          {" "}
          — This journal has no postings, so no amount can be stated.
        </span>
      </span>
    );
  }

  const tone = TREND_TONE[signedTrend(row.signedAmountMinor)];
  return (
    <span className={`tabular-nums ${tone}`}>
      {formatMoney(row.signedAmountMinor, row.currency, row.minorUnits)}
    </span>
  );
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

function MethodNote() {
  return (
    <Card>
      <Card.Header className="p-5 pb-2">
        <Card.Title className="text-sm font-medium">How to read this list</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2 px-5 pb-5 text-sm text-muted">
        <p>
          Amount is the signed characteristic leg: household inflow from
          outside is positive (negated EXTERNAL postings); otherwise the cash
          or facility financing leg; otherwise half the absolute posting
          total for a neutral internal move.
        </p>
        <p>
          A <span className="text-warning">Superseded</span> chip means the
          journal was corrected rather than deleted. The correcting journal
          names the id it replaces. Replay and every balance ignore
          superseded rows.
        </p>
      </Card.Content>
    </Card>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-medium text-foreground">Transactions</h1>
        <p className="text-sm text-muted">
          Immutable journals — the source of truth every balance is replayed
          from.
        </p>
      </div>
      {children}
    </div>
  );
}

function NoJournalsState({
  message,
  hasAccounts,
}: {
  message: string | undefined;
  hasAccounts: boolean;
}) {
  const { title, description } = noJournalsReason(message, hasAccounts);

  return (
    <Card>
      <Card.Content className="p-8">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:list-ul" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>{title}</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Card.Content>
    </Card>
  );
}

function noJournalsReason(
  message: string | undefined,
  hasAccounts: boolean,
): { title: string; description: string } {
  switch (message) {
    case "DATABASE_URL not configured":
      return {
        title: "No database configured",
        description:
          "DATABASE_URL is not set, so there is no ledger to load. Set it and restart the app.",
      };
    case "not authenticated":
      return {
        title: "Not signed in",
        description:
          "Journals are scoped to a household, which comes from the session. Sign in to load them.",
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
          "There are no accounts in this household, so there are no journals to show.",
      };
    default:
      if (!hasAccounts) {
        return {
          title: "No accounts yet",
          description:
            "There are no accounts in this household, so there are no journals to show.",
        };
      }
      return {
        title: "No journals yet",
        description:
          "The household has accounts, but no journals have been posted. Record a deposit or trade to see it here.",
      };
  }
}
