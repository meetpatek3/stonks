"use client";

import { Card, Chip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Icon } from "@iconify/react";
import { formatMoney, type PortfolioSnapshot } from "@/lib/portfolio-shared";

type DashboardProps = {
  snapshot: PortfolioSnapshot;
};

export function Dashboard({ snapshot }: DashboardProps) {
  const totalAccounts = snapshot.balances.length;
  const reportingCurrency = snapshot.reportingCurrency ?? "CAD";
  const cashLike = snapshot.balances.filter((b) =>
    ["CASH", "EXTERNAL"].includes(b.accountType),
  );
  const investmentLike = snapshot.balances.filter((b) => b.accountType === "INVESTMENT");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Portfolio overview</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <Chip variant="soft" color="accent">
            Ledger v{snapshot.ledgerVersion}
          </Chip>
        </div>
      </header>

      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>Accounts</KPI.Title>
            <KPI.Icon>
              <Icon icon="gravity-ui:folders" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value value={totalAccounts} />
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">With non-zero replay balances</span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Reporting Currency</KPI.Title>
            <KPI.Icon>
              <Icon icon="gravity-ui:circle-dollar" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {reportingCurrency}
            </p>
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">Household default</span>
          </KPI.Footer>
        </KPI>

        <KPI>
          <KPI.Header>
            <KPI.Title>Investment Accounts</KPI.Title>
            <KPI.Icon status="success">
              <Icon icon="gravity-ui:chart-column" width={18} />
            </KPI.Icon>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value value={investmentLike.length} />
          </KPI.Content>
          <KPI.Footer>
            <span className="text-sm text-muted">{cashLike.length} cash / external</span>
          </KPI.Footer>
        </KPI>
      </KPIGroup>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Balances</h2>
          <span className="text-sm text-muted">Derived by ledger replay</span>
        </div>

        {snapshot.balances.length === 0 ? (
          <Card>
            <Card.Content className="p-8">
              <EmptyState>
                <EmptyState.Header>
                  <EmptyState.Media>
                    <Icon icon="gravity-ui:briefcase" width={28} />
                  </EmptyState.Media>
                  <EmptyState.Title>No balances yet</EmptyState.Title>
                  <EmptyState.Description>
                    {snapshot.message === "no accounts"
                      ? "Create accounts and post journals to see balances here."
                      : (snapshot.message ??
                        "Connect Postgres and seed a household to get started.")}
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            </Card.Content>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {snapshot.balances.map((row) => (
              <Card key={row.accountId}>
                <Card.Header className="flex items-start justify-between gap-3 p-5 pb-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium">{row.accountName}</h3>
                    <p className="text-sm text-muted">{row.accountId}</p>
                  </div>
                  <Chip size="sm" variant="soft">
                    {row.accountType}
                  </Chip>
                </Card.Header>
                <Card.Content className="p-5 pt-2">
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">
                    {formatMoney(row.minor, row.currency, row.minorUnits)}
                  </p>
                </Card.Content>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
