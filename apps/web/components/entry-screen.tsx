"use client";

import {
  Button,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import type { FacilityUse, JournalType } from "@stonks/ledger";
import type { AccountRef } from "@/lib/ledger-table";
import {
  balancedMovePostings,
  decimalAmountToMinorString,
  defaultEntryAccounts,
} from "@/lib/journals";

const JOURNAL_TYPES: JournalType[] = [
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST_CHARGED",
  "INTEREST_EARNED",
  "FEE",
  "OPENING",
];

const FACILITY_USES: FacilityUse[] = [
  "INVESTMENT",
  "LENDING",
  "PERSONAL",
  "OTHER",
];

export type EntryScreenProps = {
  accounts: AccountRef[];
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  message?: string | undefined;
};

export function EntryScreen({
  accounts,
  reportingCurrency,
  minorUnits,
  mruAccountId,
  defaultTradeDate,
  message,
}: EntryScreenProps) {
  if (accounts.length < 2) {
    return (
      <Screen>
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:plus" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>Need two accounts to post</EmptyState.Title>
            <EmptyState.Description>
              {message === "DATABASE_URL not configured"
                ? "Database is not configured."
                : message === "not authenticated"
                  ? "Sign in to record a journal."
                  : message === "household not found"
                    ? "Household was not found."
                    : "Create at least two accounts (for example Cash and External) before recording a journal."}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Screen>
    );
  }

  return (
    <Screen>
      <EntryForm
        accounts={accounts}
        reportingCurrency={reportingCurrency}
        minorUnits={minorUnits}
        mruAccountId={mruAccountId}
        defaultTradeDate={defaultTradeDate}
      />
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl min-w-0 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Fast entry
        </h1>
        <p className="text-sm text-muted">
          Post a balanced journal in about fifteen seconds. Amounts are in the
          household reporting currency.
        </p>
      </header>
      {children}
    </div>
  );
}

function EntryForm({
  accounts,
  reportingCurrency,
  minorUnits,
  mruAccountId,
  defaultTradeDate,
}: {
  accounts: AccountRef[];
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
}) {
  const initial = defaultEntryAccounts({
    type: "DEPOSIT",
    accounts,
    mruId: mruAccountId,
  });

  const [type, setType] = useState<JournalType>("DEPOSIT");
  const [tradeDate, setTradeDate] = useState(defaultTradeDate);
  const [amount, setAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState(initial.fromId ?? "");
  const [toAccountId, setToAccountId] = useState(initial.toId ?? "");
  const [memo, setMemo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [securityId, setSecurityId] = useState("");
  const [facilityUse, setFacilityUse] = useState<FacilityUse>("INVESTMENT");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const needsFacilityUse = fromAccount?.type === "CREDIT_FACILITY";
  const showSecurityFields = type === "BUY" || type === "SELL";

  useEffect(() => {
    const next = defaultEntryAccounts({
      type,
      accounts,
      mruId: mruAccountId,
    });
    if (next.fromId) setFromAccountId(next.fromId);
    if (next.toId) setToAccountId(next.toId);
  }, [type, accounts, mruAccountId]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccessId(null);

    try {
      if (!fromAccountId || !toAccountId) {
        setError("Choose both From and To accounts");
        return;
      }
      if (fromAccountId === toAccountId) {
        setError("From and To must be different accounts");
        return;
      }

      const minorString = decimalAmountToMinorString(amount, minorUnits);
      if (minorString === null) {
        setError("Amount must be a plain decimal number");
        return;
      }
      const amountMinor = BigInt(minorString);
      if (amountMinor <= 0n) {
        setError("Amount must be greater than zero");
        return;
      }

      const quantityOn =
        type === "SELL" ? ("from" as const) : ("to" as const);
      const postings = balancedMovePostings({
        amountMinor,
        fromAccountId,
        toAccountId,
        ...(showSecurityFields && quantity
          ? {
              quantityOn,
              quantity,
              ...(securityId ? { securityId } : {}),
            }
          : showSecurityFields && securityId
            ? { quantityOn, securityId }
            : {}),
      });

      const body: Record<string, unknown> = {
        type,
        tradeDate,
        postings,
      };
      if (memo.trim()) body.memo = memo.trim();

      if (needsFacilityUse) {
        body.facilityUses = [
          { use: facilityUse, amountMinor: amountMinor.toString() },
        ];
      }

      const response = await fetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok) {
        setError(data.error ?? "Failed to post journal");
        return;
      }

      setSuccessId(data.id ?? "posted");
      setAmount("");
      setMemo("");
      setQuantity("");
      setSecurityId("");
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Select
        className="w-full"
        selectedKey={type}
        onSelectionChange={(key) => {
          if (key == null) return;
          setType(String(key) as JournalType);
        }}
        aria-label="Journal type"
      >
        <Label>Journal type</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {JOURNAL_TYPES.map((t) => (
              <ListBox.Item key={t} id={t} textValue={t}>
                {t.replaceAll("_", " ")}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <TextField
        name="tradeDate"
        isRequired
        className="w-full"
        value={tradeDate}
        onChange={setTradeDate}
      >
        <Label>Trade date</Label>
        <Input type="date" />
      </TextField>

      <TextField
        name="amount"
        isRequired
        className="w-full"
        value={amount}
        onChange={setAmount}
      >
        <Label>Amount ({reportingCurrency})</Label>
        <Input inputMode="decimal" placeholder="1000.00" autoComplete="off" />
      </TextField>

      <AccountSelect
        label="From"
        accounts={accounts}
        selectedKey={fromAccountId}
        onSelect={setFromAccountId}
      />

      <AccountSelect
        label="To"
        accounts={accounts}
        selectedKey={toAccountId}
        onSelect={setToAccountId}
      />

      {needsFacilityUse ? (
        <Select
          className="w-full"
          selectedKey={facilityUse}
          onSelectionChange={(key) => {
            if (key == null) return;
            setFacilityUse(String(key) as FacilityUse);
          }}
          aria-label="Facility use"
        >
          <Label>Facility use</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {FACILITY_USES.map((use) => (
                <ListBox.Item key={use} id={use} textValue={use}>
                  {use}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : null}

      {showSecurityFields ? (
        <>
          <TextField
            name="quantity"
            className="w-full"
            value={quantity}
            onChange={setQuantity}
          >
            <Label>Quantity</Label>
            <Input inputMode="decimal" placeholder="10" autoComplete="off" />
          </TextField>
          <TextField
            name="securityId"
            className="w-full"
            value={securityId}
            onChange={setSecurityId}
          >
            <Label>Security id</Label>
            <Input placeholder="XEQT" autoComplete="off" />
          </TextField>
        </>
      ) : null}

      <TextField name="memo" className="w-full" value={memo} onChange={setMemo}>
        <Label>Memo</Label>
        <Input placeholder="What happened" autoComplete="off" />
      </TextField>

      {error ? (
        <FieldError className="text-danger">{error}</FieldError>
      ) : null}

      {successId ? (
        <p className="text-sm text-success" role="status">
          Posted journal {successId}
        </p>
      ) : null}

      <Button type="submit" variant="primary" isPending={pending} fullWidth>
        Post journal
      </Button>
    </form>
  );
}

function AccountSelect({
  label,
  accounts,
  selectedKey,
  onSelect,
}: {
  label: string;
  accounts: AccountRef[];
  selectedKey: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Select
      className="w-full"
      selectedKey={selectedKey || null}
      onSelectionChange={(key) => {
        if (key == null) return;
        onSelect(String(key));
      }}
      aria-label={label}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {accounts.map((account) => (
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
  );
}
