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
import { buildEntryPostings } from "@/lib/entry-postings";
import { cashAvailableMinor, cashShortfallMinor } from "@/lib/entry-sufficiency";
import { formatMoney } from "@/lib/format";
import { decimalAmountToMinorString } from "@/lib/journals";

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
  householdAccounts: AccountRef[];
  externalAccountId: string | null;
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  cashByAccountId: Record<string, string>;
  positions: Array<{
    accountId: string;
    securityId: string;
    quantity: string;
  }>;
  securityIds: string[];
  message?: string | undefined;
};

export function EntryScreen({
  householdAccounts,
  externalAccountId,
  reportingCurrency,
  minorUnits,
  mruAccountId,
  defaultTradeDate,
  cashByAccountId,
  positions,
  securityIds,
  message,
}: EntryScreenProps) {
  if (!externalAccountId || householdAccounts.length === 0) {
    return (
      <Screen>
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:plus" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>Need accounts to post</EmptyState.Title>
            <EmptyState.Description>
              {message === "DATABASE_URL not configured"
                ? "Database is not configured."
                : message === "not authenticated"
                  ? "Sign in to record a journal."
                  : message === "household not found"
                    ? "Household was not found."
                    : !externalAccountId
                      ? "Create an External account before recording a journal."
                      : "Create at least one household account before recording a journal."}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </Screen>
    );
  }

  return (
    <Screen>
      <EntryForm
        householdAccounts={householdAccounts}
        externalAccountId={externalAccountId}
        reportingCurrency={reportingCurrency}
        minorUnits={minorUnits}
        mruAccountId={mruAccountId}
        defaultTradeDate={defaultTradeDate}
        cashByAccountId={cashByAccountId}
        securityIds={securityIds}
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
  householdAccounts,
  externalAccountId,
  reportingCurrency,
  minorUnits,
  mruAccountId,
  defaultTradeDate,
  cashByAccountId,
  securityIds,
}: {
  householdAccounts: AccountRef[];
  externalAccountId: string;
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  cashByAccountId: Record<string, string>;
  securityIds: string[];
}) {
  const [type, setType] = useState<JournalType>("DEPOSIT");
  const [tradeDate, setTradeDate] = useState(defaultTradeDate);
  const [amount, setAmount] = useState("");
  const initialAccountId =
    (mruAccountId &&
      householdAccounts.some((account) => account.id === mruAccountId) &&
      mruAccountId) ||
    householdAccounts[0]?.id ||
    "";
  const [accountId, setAccountId] = useState(initialAccountId);
  const [fromAccountId, setFromAccountId] = useState(initialAccountId);
  const [toAccountId, setToAccountId] = useState(
    householdAccounts.find((account) => account.id !== initialAccountId)?.id ?? "",
  );
  const [memo, setMemo] = useState("");
  const [securityId, setSecurityId] = useState("");
  const [facilityUse, setFacilityUse] = useState<FacilityUse>("INVESTMENT");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const fromAccount = householdAccounts.find((a) => a.id === fromAccountId);
  const needsFacilityUse = fromAccount?.type === "CREDIT_FACILITY";
  const isTradeOrOpening = type === "BUY" || type === "SELL" || type === "OPENING";
  const showSecurityField =
    type === "DIVIDEND" || type === "FEE";

  useEffect(() => {
    if (type === "TRANSFER") {
      setFromAccountId(initialAccountId);
      setToAccountId(
        householdAccounts.find((account) => account.id !== initialAccountId)?.id ?? "",
      );
    } else {
      setAccountId(initialAccountId);
    }
  }, [type, householdAccounts, initialAccountId]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccessId(null);

    try {
      if (isTradeOrOpening) {
        setError("BUY, SELL, and OPENING flows are coming in the next task.");
        return;
      }
      if (type === "CORPORATE_ACTION") {
        setError("This journal type is not available in fast entry.");
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

      let postings;
      let payingAccountId: string | null = null;
      if (type === "TRANSFER") {
        if (householdAccounts.length < 2) {
          setError("Create at least two household accounts before transferring.");
          return;
        }
        if (!fromAccountId || !toAccountId) {
          setError("Choose both From and To accounts");
          return;
        }
        if (fromAccountId === toAccountId) {
          setError("From and To must be different accounts");
          return;
        }
        postings = buildEntryPostings({
          type,
          fromAccountId,
          toAccountId,
          amountMinor,
        });
        payingAccountId = fromAccountId;
      } else {
        if (!accountId) {
          setError("Choose an account");
          return;
        }
        if (
          type === "DEPOSIT" ||
          type === "DIVIDEND" ||
          type === "INTEREST_EARNED"
        ) {
          postings = buildEntryPostings({
            type,
            accountId,
            externalAccountId,
            amountMinor,
            ...(securityId ? { securityId } : {}),
          });
        } else {
          postings = buildEntryPostings({
            type,
            accountId,
            externalAccountId,
            amountMinor,
            ...(securityId ? { securityId } : {}),
          });
          payingAccountId = accountId;
        }
      }

      if (
        payingAccountId &&
        cashShortfallMinor(
          cashAvailableMinor(cashByAccountId[payingAccountId]),
          amountMinor,
        ) > 0n
      ) {
        const payingAccount = householdAccounts.find(
          (account) => account.id === payingAccountId,
        );
        setError(`Not enough cash in ${payingAccount?.name ?? "selected account"}`);
        return;
      }

      const body: Record<string, unknown> = {
        type,
        tradeDate,
        postings,
      };
      if (memo.trim()) body.memo = memo.trim();

      if (type === "TRANSFER" && needsFacilityUse) {
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

      {isTradeOrOpening ? (
        <p className="text-sm text-muted">
          BUY, SELL, and OPENING flows are coming in the next task.
        </p>
      ) : type === "TRANSFER" && householdAccounts.length < 2 ? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Icon icon="gravity-ui:arrow-right-arrow-left" width={24} />
            </EmptyState.Media>
            <EmptyState.Title>Need two household accounts</EmptyState.Title>
            <EmptyState.Description>
              Add another household account before recording a transfer.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <>
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

          {type === "TRANSFER" ? (
            <>
              <AccountSelect
                label="From"
                accounts={householdAccounts}
                selectedKey={fromAccountId}
                onSelect={setFromAccountId}
                balances={cashByAccountId}
                currency={reportingCurrency}
                minorUnits={minorUnits}
              />
              <AccountSelect
                label="To"
                accounts={householdAccounts}
                selectedKey={toAccountId}
                onSelect={setToAccountId}
              />
            </>
          ) : (
            <AccountSelect
              label={
                type === "WITHDRAWAL"
                  ? "From"
                  : type === "INTEREST_CHARGED" || type === "FEE"
                    ? "Charged on"
                    : "Into"
              }
              accounts={householdAccounts}
              selectedKey={accountId}
              onSelect={setAccountId}
            />
          )}

          {needsFacilityUse && type === "TRANSFER" ? (
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

          {showSecurityField && securityIds.length > 0 ? (
            <SecuritySelect
              securityIds={securityIds}
              selectedKey={securityId}
              onSelect={setSecurityId}
            />
          ) : showSecurityField ? (
            <TextField
              name="securityId"
              className="w-full"
              value={securityId}
              onChange={setSecurityId}
            >
              <Label>New security id</Label>
              <Input placeholder="XEQT" autoComplete="off" />
            </TextField>
          ) : null}

          <TextField name="memo" className="w-full" value={memo} onChange={setMemo}>
            <Label>Memo</Label>
            <Input placeholder="What happened" autoComplete="off" />
          </TextField>
        </>
      )}

      {error ? (
        <FieldError className="text-danger">{error}</FieldError>
      ) : null}

      {successId ? (
        <p className="text-sm text-success" role="status">
          Posted journal {successId}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        isPending={pending}
        isDisabled={isTradeOrOpening || (type === "TRANSFER" && householdAccounts.length < 2)}
        fullWidth
      >
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
  balances,
  currency,
  minorUnits,
}: {
  label: string;
  accounts: AccountRef[];
  selectedKey: string;
  onSelect: (id: string) => void;
  balances?: Record<string, string>;
  currency?: string;
  minorUnits?: number;
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
              {balances && currency
                ? ` · ${formatMoney(balances[account.id] ?? "0", currency, minorUnits)}`
                : null}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function SecuritySelect({
  securityIds,
  selectedKey,
  onSelect,
}: {
  securityIds: string[];
  selectedKey: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Select
      className="w-full"
      selectedKey={selectedKey || null}
      onSelectionChange={(key) => onSelect(key == null || String(key) === "NONE" ? "" : String(key))}
      aria-label="Security"
    >
      <Label>Security (optional)</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="NONE" textValue="None">
            None
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {securityIds.map((id) => (
            <ListBox.Item key={id} id={id} textValue={id}>
              {id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
