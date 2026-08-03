"use client";

import { Card, Chip, Label, ListBox, Select, Separator } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";
import {
  DISPLAY_LOCALE,
  UNKNOWN,
  formatBps,
  formatReportingMoney,
  minorToDisplayNumber,
} from "@/lib/format";
import { taxYearsFromValueSeries } from "@/lib/tax-summary";
import type { PortfolioSnapshot, TaxSummary } from "@/lib/portfolio-shared";
import { UncertaintyNote } from "@/components/portfolio-charts";
import type { TaxFlag } from "@stonks/ledger";

/**
 * Annual Canadian tax summary — figures and flags come straight off
 * `snapshot.taxSummary`. Nothing is derived here.
 *
 * Two distinctions carried through from the read model:
 *
 * 1. **Flags are informational.** A `SUPERFICIAL_LOSS` is a candidate the
 *    user must judge; it is listed separately and never folded into the
 *    realized-gain or taxable-gain figures above it.
 * 2. **Uncertainty means incompleteness.** A year outside the ledger's
 *    range, or a figure that could not be derived, surfaces as
 *    `isUncertain` with reasons — never as a confident zero.
 */

type TaxScreenProps = {
  snapshot: PortfolioSnapshot;
};

export function TaxScreen({ snapshot }: TaxScreenProps) {
  const tax = snapshot.taxSummary;
  const currency = snapshot.reportingCurrency ?? "CAD";
  const minorUnits = snapshot.reportingMinorUnits;
  const years = taxYearsFromValueSeries(snapshot.valueOverTime);

  if (tax === null) {
    return (
      <Screen>
        <NoTaxState message={snapshot.message} hasAccounts={snapshot.balances.length > 0} />
      </Screen>
    );
  }

  return (
    <Screen year={tax.year} jurisdiction={tax.jurisdiction}>
      <Disclaimer disclaimer={tax.disclaimer} />

      <YearPicker selectedYear={tax.year} years={years} />

      {tax.isUncertain ? (
        <UncertaintyNote title={`Tax figures for ${tax.year} are incomplete`}>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {tax.uncertaintyReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </UncertaintyNote>
      ) : null}

      <TaxKpis tax={tax} currency={currency} minorUnits={minorUnits} />

      <FlagsSection flags={tax.flags} />

      <MethodNote inclusionRateBps={tax.inclusionRateBps} />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Disclaimer — must stay prominent (warning token)                    */
/* ------------------------------------------------------------------ */

function Disclaimer({ disclaimer }: { disclaimer: string }) {
  return (
    <UncertaintyNote status="warning" title="Not tax advice">
      {disclaimer}
    </UncertaintyNote>
  );
}

/* ------------------------------------------------------------------ */
/* Year picker                                                         */
/* ------------------------------------------------------------------ */

function YearPicker({
  selectedYear,
  years,
}: {
  selectedYear: number;
  years: number[];
}) {
  const router = useRouter();
  // Keep the selected year selectable even when it falls outside the
  // ledger's coverage (e.g. `?year=2023` on a ledger that starts in 2024),
  // so the Select can show the uncertain-year state the read model already
  // produced rather than snapping back to a covered year.
  const options =
    years.includes(selectedYear) || years.length === 0
      ? years.length === 0
        ? [selectedYear]
        : years
      : [...years, selectedYear].sort((a, b) => a - b);

  return (
    <Card className="min-w-0">
      <Card.Content className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Tax year</p>
          <p className="text-sm text-muted">
            Defaults to the year of the most recent posted journal. Quiet years
            inside the ledger&apos;s range report genuine zeroes; years outside
            it are marked incomplete.
          </p>
        </div>
        <Select
          className="w-full sm:max-w-[10rem]"
          selectedKey={String(selectedYear)}
          onSelectionChange={(key) => {
            if (key == null) return;
            router.push(`/tax?year=${String(key)}`);
          }}
          aria-label="Tax year"
        >
          <Label>Year</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {options.map((year) => (
                <ListBox.Item key={year} id={String(year)} textValue={String(year)}>
                  {year}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </Card.Content>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

function TaxKpis({
  tax,
  currency,
  minorUnits,
}: {
  tax: TaxSummary;
  currency: string;
  minorUnits: number | null;
}) {
  return (
    <KPIGroup className="flex-col md:flex-row">
      <KPI>
        <KPI.Header>
          <KPI.Title>Realized gains</KPI.Title>
          <KPI.Icon status="success">
            <Icon icon="gravity-ui:arrow-up" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <ReportingMoneyValue
            minor={tax.realizedGainsMinor}
            currency={currency}
            minorUnits={minorUnits}
          />
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            Disposals with a known cost basis, before inclusion
          </span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Taxable capital gains</KPI.Title>
          <KPI.Icon>
            <Icon icon="gravity-ui:percent" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <ReportingMoneyValue
            minor={tax.taxableCapitalGainsMinor}
            currency={currency}
            minorUnits={minorUnits}
          />
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            Net gains × {formatBps(tax.inclusionRateBps)} inclusion
            {tax.realizedLossesMinor !== "0"
              ? ` · losses ${formatReportingMoney(tax.realizedLossesMinor, currency, minorUnits)}`
              : ""}
          </span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Dividend income</KPI.Title>
          <KPI.Icon>
            <Icon icon="gravity-ui:coins-3" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <ReportingMoneyValue
            minor={tax.dividendIncomeMinor}
            currency={currency}
            minorUnits={minorUnits}
          />
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            Posted DIVIDEND journals in {currency}
            {tax.interestIncomeMinor !== "0"
              ? ` · interest income ${formatReportingMoney(tax.interestIncomeMinor, currency, minorUnits)}`
              : ""}
          </span>
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Deductible investment interest</KPI.Title>
          <KPI.Icon status="warning">
            <Icon icon="gravity-ui:briefcase" width={18} />
          </KPI.Icon>
        </KPI.Header>
        <KPI.Content>
          <ReportingMoneyValue
            minor={tax.deductibleInterestExpenseMinor}
            currency={currency}
            minorUnits={minorUnits}
          />
        </KPI.Content>
        <KPI.Footer>
          <span className="text-sm text-muted">
            INVESTMENT share of interest charged, from facility-use attribution
          </span>
        </KPI.Footer>
      </KPI>
    </KPIGroup>
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
    />
  );
}

/* ------------------------------------------------------------------ */
/* Flags — informational, never applied to the figures                 */
/* ------------------------------------------------------------------ */

function FlagsSection({ flags }: { flags: TaxFlag[] }) {
  return (
    <Card className="min-w-0 border border-warning/40 bg-surface-secondary">
      <Card.Header className="flex flex-col gap-2 p-5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Card.Title className="text-base font-medium">Tax flags</Card.Title>
          <Chip size="sm" variant="soft" color="warning">
            Informational — not applied to the figures
          </Chip>
        </div>
        <Card.Description className="text-sm text-muted">
          Flags are candidates you must judge. A superficial-loss flag, for
          example, does not adjust realized or taxable gains above — the
          summary only reports that a review may be needed.
        </Card.Description>
      </Card.Header>
      <Separator />
      <Card.Content className="p-5">
        {flags.length === 0 ? (
          <p className="text-sm text-muted">
            No flags for this year. Nothing was raised as a candidate for
            review.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {flags.map((flag, index) => (
              <li
                key={`${flag.code}-${flag.journalIds?.join(",") ?? index}`}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="soft" color="warning">
                    {flag.code.replaceAll("_", " ")}
                  </Chip>
                  {flag.journalIds?.map((id) => (
                    <Chip key={id} size="sm" variant="soft">
                      Journal {id}
                    </Chip>
                  ))}
                </div>
                <p className="text-sm text-foreground">{flag.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shell / empty / method                                              */
/* ------------------------------------------------------------------ */

function Screen({
  children,
  year,
  jurisdiction,
}: {
  children: React.ReactNode;
  year?: number;
  jurisdiction?: string;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted">Annual tax summary</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Tax</h1>
          <div className="flex flex-wrap items-center gap-2">
            {jurisdiction ? (
              <Chip variant="soft" color="accent">
                {jurisdiction}
              </Chip>
            ) : null}
            {year !== undefined ? (
              <Chip variant="soft">{year}</Chip>
            ) : null}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function MethodNote({ inclusionRateBps }: { inclusionRateBps: number }) {
  return (
    <Card className="min-w-0">
      <Card.Content className="flex flex-col gap-2 p-5 text-sm text-muted">
        <p className="font-medium text-foreground">How these figures are derived</p>
        <p>
          Realized gains and losses come from dispositions replayed by the
          ledger. Taxable capital gains apply a{" "}
          {formatBps(inclusionRateBps)} Canadian inclusion rate to net gains.
          Dividend and interest income are amounts that landed in household
          accounts. Deductible investment interest is only the INVESTMENT share
          of each INTEREST_CHARGED journal that carries facility-use
          attribution — a charge with none is excluded and named under
          uncertainty, never guessed.
        </p>
        <p>
          Flags are listed separately and are never silently applied to the
          numbers. This is not tax advice.
        </p>
      </Card.Content>
    </Card>
  );
}

function NoTaxState({
  message,
  hasAccounts,
}: {
  message: string | undefined;
  hasAccounts: boolean;
}) {
  const { title, description } = noTaxReason(message, hasAccounts);

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

function noTaxReason(
  message: string | undefined,
  hasAccounts: boolean,
): { title: string; description: string } {
  switch (message) {
    case "DATABASE_URL not configured":
      return {
        title: "No database configured",
        description:
          "DATABASE_URL is not set, so there is no ledger to summarize. Set it and restart the app.",
      };
    case "not authenticated":
      return {
        title: "Not signed in",
        description:
          "Tax figures are scoped to a household, which comes from the session. Sign in to load them.",
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
          "The household has no accounts, so there is nothing to replay into a tax year.",
      };
    default:
      return {
        title: "No tax year to summarize",
        description:
          message ??
          (hasAccounts
            ? "The household has accounts but no posted journals, so there is no tax year to derive. Post a transaction to see a summary."
            : "There is no posted activity to summarize for a tax year."),
      };
  }
}
