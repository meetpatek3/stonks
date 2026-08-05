"use client";

import type { AccountRecord, CurrencyRecord } from "@stonks/db";
import type { AccountType } from "@stonks/ledger";
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  TextField,
  useOverlayState,
} from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney, signedTrend, type Trend } from "@/lib/format";
import {
  accountTone,
  isLiabilityType,
  mergeAccountsWithBalances,
  sortBalanceRows,
  type AccountOverviewRow,
} from "@/lib/accounts-table";
import type { PortfolioSnapshot } from "@/lib/portfolio-shared";

/**
 * Account overview — persisted household accounts paired with replay balances.
 *
 * Account creation and closure go through the cookie-authenticated HTTP API.
 * The screen never accepts or stores a balance: an account absent from replay
 * is displayed at zero because no journal has ever touched it.
 */

const TREND_TONE: Record<Trend, string> = {
  up: "text-success",
  down: "text-danger",
  neutral: "text-foreground",
};

/**
 * EXTERNAL is the counterpart for flows crossing the household boundary.
 * The overview intentionally hides it, so offering it here would create an invisible account.
 */
const ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: "INVESTMENT", label: "Investment" },
  { value: "CREDIT_FACILITY", label: "Credit facility" },
  { value: "RECEIVABLE", label: "Receivable" },
  { value: "CASH", label: "Cash" },
];

type AccountsScreenProps = {
  snapshot: PortfolioSnapshot;
  accounts: AccountRecord[];
  currencies: CurrencyRecord[];
  includeClosed: boolean;
};

export function AccountsScreen({
  snapshot,
  accounts,
  currencies,
  includeClosed,
}: AccountsScreenProps) {
  const rows = sortBalanceRows(
    mergeAccountsWithBalances(accounts, snapshot.balances),
  );
  const unavailable =
    snapshot.message === "DATABASE_URL not configured" ||
    snapshot.message === "not authenticated" ||
    snapshot.message === "household not found";

  return (
    <Screen
      currency={snapshot.reportingCurrency}
      actions={
        unavailable ? null : (
          <AccountActions
            currencies={currencies}
            includeClosed={includeClosed}
          />
        )
      }
    >
      {rows.length === 0 ? (
        <NoAccountsState message={snapshot.message} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <AccountCard key={row.accountId} row={row} />
          ))}
        </div>
      )}
    </Screen>
  );
}

function AccountActions({
  currencies,
  includeClosed,
}: {
  currencies: CurrencyRecord[];
  includeClosed: boolean;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Switch
        size="sm"
        isSelected={includeClosed}
        onChange={(selected) => {
          router.replace(selected ? "/accounts?includeClosed=true" : "/accounts");
        }}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>Show closed accounts</Label>
        </Switch.Content>
      </Switch>
      <AddAccountDialog currencies={currencies} />
    </div>
  );
}

function AddAccountDialog({ currencies }: { currencies: CurrencyRecord[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CASH");
  const [currency, setCurrency] = useState(currencies[0]?.code ?? "");
  const [taxTreatment, setTaxTreatment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useOverlayState({
    onOpenChange(isOpen) {
      if (!isOpen) setError(null);
    },
  });

  function resetForm() {
    setName("");
    setType("CASH");
    setCurrency(currencies[0]?.code ?? "");
    setTaxTreatment("");
    setError(null);
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          currency,
          ...(taxTreatment.trim().length === 0 ? {} : { taxTreatment }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not create the account");
        return;
      }

      resetForm();
      dialog.close();
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal state={dialog}>
      <Modal.Trigger>
        <Button variant="primary">
          <Icon icon="gravity-ui:plus" width={16} />
          Add account
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <form onSubmit={createAccount}>
              <Modal.Header>
                <Modal.Heading>Add account</Modal.Heading>
                <Modal.CloseTrigger isDisabled={pending} />
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <TextField
                  className="w-full"
                  value={name}
                  onChange={setName}
                  isRequired
                >
                  <Label>Name</Label>
                  <Input placeholder="e.g. Chequing" autoComplete="off" />
                </TextField>

                <Select
                  className="w-full"
                  selectedKey={type}
                  onSelectionChange={(key) => {
                    if (key !== null) setType(String(key) as AccountType);
                  }}
                  aria-label="Account type"
                >
                  <Label>Type</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {ACCOUNT_TYPES.map((option) => (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          textValue={option.label}
                        >
                          {option.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>

                <Select
                  className="w-full"
                  selectedKey={currency || null}
                  onSelectionChange={(key) => {
                    if (key !== null) setCurrency(String(key));
                  }}
                  aria-label="Account currency"
                  isRequired
                >
                  <Label>Currency</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {currencies.map((option) => (
                        <ListBox.Item
                          key={option.code}
                          id={option.code}
                          textValue={`${option.code} — ${option.name}`}
                        >
                          {option.code} — {option.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>

                <div className="flex flex-col gap-1">
                  <TextField
                    className="w-full"
                    value={taxTreatment}
                    onChange={setTaxTreatment}
                  >
                    <Label>Tax treatment (optional)</Label>
                    <Input placeholder="e.g. TFSA or RRSP" autoComplete="off" />
                  </TextField>
                  <p className="text-xs text-muted">
                    Use this for registered accounts such as a TFSA or RRSP.
                  </p>
                </div>

                {error ? <p className="text-sm text-danger">{error}</p> : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={pending}
                  onPress={() => {
                    resetForm();
                    dialog.close();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isPending={pending}
                  isDisabled={
                    pending || name.trim().length === 0 || currency.length === 0
                  }
                >
                  Add account
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function AccountCard({ row }: { row: AccountOverviewRow }) {
  const liability = isLiabilityType(row.accountType);
  const tone = accountTone(row.accountType);
  const amountTone = TREND_TONE[signedTrend(row.minor)];
  const closed = row.closedAt !== null;

  return (
    <Card className={closed ? "min-w-0 opacity-60" : "min-w-0"}>
      <Card.Header className="flex flex-wrap items-start justify-between gap-2 p-5 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-base font-medium">
            {row.accountName}
          </Card.Title>
          <Card.Description className="text-sm text-muted">
            {ACCOUNT_TYPES.find((option) => option.value === row.accountType)?.label}
          </Card.Description>
        </div>
        <div className="flex flex-wrap gap-1">
          {closed ? (
            <Chip size="sm" variant="soft">
              Closed
            </Chip>
          ) : null}
          {row.taxTreatment ? (
            <Chip size="sm" variant="soft">
              {row.taxTreatment}
            </Chip>
          ) : null}
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
      <Card.Content className="flex flex-col gap-4 px-5 pb-5">
        <div>
          <p className={`text-2xl font-medium tabular-nums ${amountTone}`}>
            {formatMoney(row.minor, row.currency, row.minorUnits)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Replay balance — derived, never stored.
          </p>
        </div>
        {closed ? null : <CloseAccountDialog row={row} />}
      </Card.Content>
    </Card>
  );
}

function CloseAccountDialog({ row }: { row: AccountOverviewRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function closeAccount() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${row.accountId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not close the account");
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (pending) return;
        setOpen(isOpen);
        if (!isOpen) setError(null);
      }}
    >
      <AlertDialog.Trigger className="self-start">
        <Button size="sm" variant="danger-soft">
          Close account
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon />
              <AlertDialog.Heading>Close {row.accountName}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                This account will stop appearing in the default accounts view.
                Only an account with a zero replay balance can be closed.
              </p>
              {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="ghost"
                isDisabled={pending}
                onPress={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                isPending={pending}
                isDisabled={pending}
                onPress={closeAccount}
              >
                Close account
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

function Screen({
  actions,
  children,
  currency,
}: {
  actions: React.ReactNode;
  children: React.ReactNode;
  currency: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-medium text-foreground">Accounts</h1>
          <p className="text-sm text-muted">
            Household accounts and their replayed balances.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {actions}
          {currency ? (
            <Chip size="sm" variant="soft">
              {currency}
            </Chip>
          ) : null}
        </div>
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
