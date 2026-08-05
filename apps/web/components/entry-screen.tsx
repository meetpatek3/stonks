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
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { qtyFromDecimalString, type FacilityUse, type JournalType } from "@stonks/ledger";
import type { AccountRef } from "@/lib/ledger-table";
import { buildEntryPostings } from "@/lib/entry-postings";
import {
  cashAvailableMinor,
  cashShortfallMinor,
  exceedsPositionQty,
} from "@/lib/entry-sufficiency";
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

const ADD_SECURITY_KEY = "__ADD_SECURITY__";

type PositionRow = {
  accountId: string;
  securityId: string;
  quantity: string;
};

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
        positions={positions}
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

function preferBrokerageAccountId(
  accounts: AccountRef[],
  fallbackId: string,
): string {
  const investment = accounts.find((account) => account.type === "INVESTMENT");
  if (investment) return investment.id;
  const cash = accounts.find((account) => account.type === "CASH");
  if (cash) return cash.id;
  return fallbackId;
}

function pickFundFromAccountId(
  accounts: AccountRef[],
  brokerageId: string,
  shortfall: bigint,
  cashByAccountId: Record<string, string>,
): string {
  const others = accounts.filter((account) => account.id !== brokerageId);
  const funded = others.find(
    (account) =>
      cashAvailableMinor(cashByAccountId[account.id]) >= shortfall,
  );
  return funded?.id ?? others[0]?.id ?? "";
}

/** Format minor units as a plain decimal for amount inputs (string/bigint only). */
function minorToAmountInput(minor: bigint, minorUnits: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const digits = abs.toString();
  if (minorUnits <= 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(minorUnits + 1, "0");
  const whole = padded.slice(0, -minorUnits);
  const frac = padded.slice(-minorUnits);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function isPositiveQuantity(value: string): boolean {
  try {
    return qtyFromDecimalString(value).scaled > 0n;
  } catch {
    return false;
  }
}

function EntryForm({
  householdAccounts,
  externalAccountId,
  reportingCurrency,
  minorUnits,
  mruAccountId,
  defaultTradeDate,
  cashByAccountId,
  positions,
  securityIds,
}: {
  householdAccounts: AccountRef[];
  externalAccountId: string;
  reportingCurrency: string;
  minorUnits: number;
  mruAccountId: string | null;
  defaultTradeDate: string;
  cashByAccountId: Record<string, string>;
  positions: PositionRow[];
  securityIds: string[];
}) {
  const router = useRouter();
  const [type, setType] = useState<JournalType>("DEPOSIT");
  const [mode, setMode] = useState<"entry" | "fund-transfer">("entry");
  const [tradeDate, setTradeDate] = useState(defaultTradeDate);
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
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
  const chargedAccount = householdAccounts.find((a) => a.id === accountId);
  const brokerageAccount = householdAccounts.find((a) => a.id === accountId);
  const needsFacilityUse = fromAccount?.type === "CREDIT_FACILITY";
  const isBuyOrSell = type === "BUY" || type === "SELL";
  const isOpening = type === "OPENING";
  const showOptionalSecurityField = type === "DIVIDEND" || type === "FEE";

  useEffect(() => {
    setMode("entry");
    setError(null);
    setSuccessId(null);
    setQuantity("");

    if (type === "TRANSFER") {
      setFromAccountId(initialAccountId);
      setToAccountId(
        householdAccounts.find((account) => account.id !== initialAccountId)?.id ??
          "",
      );
    } else if (type === "BUY" || type === "SELL") {
      setAccountId(preferBrokerageAccountId(householdAccounts, initialAccountId));
    } else {
      setAccountId(initialAccountId);
    }

    setSecurityId("");
  }, [type, householdAccounts, initialAccountId]);

  async function postJournal(body: Record<string, unknown>): Promise<string | null> {
    const response = await fetch("/api/journals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { id?: string; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to post journal");
      return null;
    }
    return data.id ?? "posted";
  }

  async function submitFundTransfer(): Promise<void> {
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

    const minorString = decimalAmountToMinorString(transferAmount, minorUnits);
    if (minorString === null) {
      setError("Amount must be a plain decimal number");
      return;
    }
    const amountMinor = BigInt(minorString);
    if (amountMinor <= 0n) {
      setError("Amount must be greater than zero");
      return;
    }

    const skipCashGate = fromAccount?.type === "CREDIT_FACILITY";
    if (
      !skipCashGate &&
      cashShortfallMinor(
        cashAvailableMinor(cashByAccountId[fromAccountId]),
        amountMinor,
      ) > 0n
    ) {
      setError(`Not enough cash in ${fromAccount?.name ?? "selected account"}`);
      return;
    }

    const postings = buildEntryPostings({
      type: "TRANSFER",
      fromAccountId,
      toAccountId,
      amountMinor,
    });
    const body: Record<string, unknown> = {
      type: "TRANSFER",
      tradeDate,
      postings,
    };
    if (memo.trim()) body.memo = memo.trim();
    if (needsFacilityUse) {
      body.facilityUses = [
        { use: facilityUse, amountMinor: amountMinor.toString() },
      ];
    }

    const id = await postJournal(body);
    if (id === null) return;

    setSuccessId(id);
    setMode("entry");
    setTransferAmount("");
    router.refresh();
  }

  async function submitBuyOrSell(): Promise<void> {
    if (!accountId) {
      setError("Choose a brokerage account");
      return;
    }
    const sid = securityId.trim();
    if (!sid) {
      setError("Choose or enter a security");
      return;
    }
    const qty = quantity.trim();
    if (!isPositiveQuantity(qty)) {
      setError("Quantity must be a positive decimal number");
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

    if (type === "SELL") {
      const position = positions.find(
        (row) => row.accountId === accountId && row.securityId === sid,
      );
      if (exceedsPositionQty(position?.quantity, qty)) {
        setError("Sell quantity exceeds position held in this account");
        return;
      }

      const postings = buildEntryPostings({
        type: "SELL",
        accountId,
        amountMinor,
        quantity: qty,
        securityId: sid,
      });
      const body: Record<string, unknown> = {
        type,
        tradeDate,
        postings,
      };
      if (memo.trim()) body.memo = memo.trim();

      const id = await postJournal(body);
      if (id === null) return;

      setSuccessId(id);
      setAmount("");
      setQuantity("");
      setMemo("");
      setSecurityId("");
      router.refresh();
      return;
    }

    // BUY — same-account cash funding only; shortfall enters guided transfer.
    const shortfall = cashShortfallMinor(
      cashAvailableMinor(cashByAccountId[accountId]),
      amountMinor,
    );
    if (shortfall > 0n) {
      const brokerName = brokerageAccount?.name ?? "selected account";
      if (householdAccounts.length < 2) {
        setError(`Not enough cash in ${brokerName}`);
        return;
      }
      const fromId = pickFundFromAccountId(
        householdAccounts,
        accountId,
        shortfall,
        cashByAccountId,
      );
      if (!fromId) {
        setError(`Not enough cash in ${brokerName}`);
        return;
      }
      setToAccountId(accountId);
      setFromAccountId(fromId);
      setTransferAmount(minorToAmountInput(shortfall, minorUnits));
      setMode("fund-transfer");
      setError(null);
      setSuccessId(null);
      return;
    }

    const postings = buildEntryPostings({
      type: "BUY",
      accountId,
      amountMinor,
      quantity: qty,
      securityId: sid,
    });
    const body: Record<string, unknown> = {
      type,
      tradeDate,
      postings,
    };
    if (memo.trim()) body.memo = memo.trim();

    const id = await postJournal(body);
    if (id === null) return;

    setSuccessId(id);
    setAmount("");
    setQuantity("");
    setMemo("");
    setSecurityId("");
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    if (mode !== "fund-transfer") {
      setSuccessId(null);
    }

    try {
      if (mode === "fund-transfer") {
        await submitFundTransfer();
        return;
      }
      if (isOpening) {
        setError("OPENING flow is coming in the next task.");
        return;
      }
      if (type === "CORPORATE_ACTION") {
        setError("This journal type is not available in fast entry.");
        return;
      }
      if (isBuyOrSell) {
        await submitBuyOrSell();
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
      let skipCashGate = false;
      const securityIdForPostings =
        (type === "DIVIDEND" || type === "FEE") && securityId
          ? { securityId }
          : {};
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
        // Facility draws increase liability (balance ≤ 0); cash sufficiency does not apply.
        skipCashGate = fromAccount?.type === "CREDIT_FACILITY";
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
            ...securityIdForPostings,
          });
        } else {
          postings = buildEntryPostings({
            type,
            accountId,
            externalAccountId,
            amountMinor,
            ...securityIdForPostings,
          });
          payingAccountId = accountId;
          // Capitalized interest on a facility is not a cash outflow.
          skipCashGate =
            type === "INTEREST_CHARGED" &&
            chargedAccount?.type === "CREDIT_FACILITY";
        }
      }

      if (
        payingAccountId &&
        !skipCashGate &&
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

      const id = await postJournal(body);
      if (id === null) return;

      setSuccessId(id);
      setAmount("");
      setMemo("");
      setSecurityId("");
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  if (mode === "fund-transfer") {
    const brokerName = brokerageAccount?.name ?? "brokerage";
    const otherAccounts = householdAccounts.filter(
      (account) => account.id !== toAccountId,
    );
    return (
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <p className="text-sm text-foreground">
          Not enough cash in {brokerName}. Transfer in first?
        </p>

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
          name="transferAmount"
          isRequired
          className="w-full"
          value={transferAmount}
          onChange={setTransferAmount}
        >
          <Label>Amount ({reportingCurrency})</Label>
          <Input inputMode="decimal" placeholder="1000.00" autoComplete="off" />
        </TextField>

        <AccountSelect
          label="From"
          accounts={otherAccounts.length > 0 ? otherAccounts : householdAccounts}
          selectedKey={fromAccountId}
          onSelect={setFromAccountId}
          balances={cashByAccountId}
          currency={reportingCurrency}
          minorUnits={minorUnits}
        />

        <AccountSelect
          label="To"
          accounts={householdAccounts.filter((account) => account.id === toAccountId)}
          selectedKey={toAccountId}
          onSelect={() => {
            /* locked to brokerage */
          }}
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

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" isPending={pending} fullWidth>
            Post transfer
          </Button>
          <Button
            type="button"
            variant="secondary"
            isDisabled={pending}
            fullWidth
            onPress={() => {
              setMode("entry");
              setError(null);
              setTransferAmount("");
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
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

      {isOpening ? (
        <p className="text-sm text-muted">
          OPENING flow is coming in the next task.
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

          {isBuyOrSell ? (
            <>
              <AccountSelect
                label="Brokerage"
                accounts={householdAccounts}
                selectedKey={accountId}
                onSelect={setAccountId}
                balances={cashByAccountId}
                currency={reportingCurrency}
                minorUnits={minorUnits}
              />

              <TradeSecurityField
                key={type}
                securityIds={securityIds}
                value={securityId}
                onChange={setSecurityId}
              />

              <TextField
                name="quantity"
                isRequired
                className="w-full"
                value={quantity}
                onChange={setQuantity}
              >
                <Label>{type === "SELL" ? "Quantity sold" : "Quantity"}</Label>
                <Input inputMode="decimal" placeholder="10" autoComplete="off" />
              </TextField>

              <TextField
                name="amount"
                isRequired
                className="w-full"
                value={amount}
                onChange={setAmount}
              >
                <Label>
                  {type === "SELL"
                    ? `Proceeds (${reportingCurrency})`
                    : `Cost (${reportingCurrency})`}
                </Label>
                <Input
                  inputMode="decimal"
                  placeholder="1000.00"
                  autoComplete="off"
                />
              </TextField>
            </>
          ) : (
            <>
              <TextField
                name="amount"
                isRequired
                className="w-full"
                value={amount}
                onChange={setAmount}
              >
                <Label>Amount ({reportingCurrency})</Label>
                <Input
                  inputMode="decimal"
                  placeholder="1000.00"
                  autoComplete="off"
                />
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

              {showOptionalSecurityField && securityIds.length > 0 ? (
                <SecuritySelect
                  securityIds={securityIds}
                  selectedKey={securityId}
                  onSelect={setSecurityId}
                />
              ) : showOptionalSecurityField ? (
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
            </>
          )}

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
        isDisabled={
          isOpening || (type === "TRANSFER" && householdAccounts.length < 2)
        }
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

function TradeSecurityField({
  securityIds,
  value,
  onChange,
}: {
  securityIds: string[];
  value: string;
  onChange: (id: string) => void;
}) {
  const known = value !== "" && securityIds.includes(value);
  const [adding, setAdding] = useState(securityIds.length === 0 || (value !== "" && !known));
  const [draft, setDraft] = useState(adding ? value : "");

  useEffect(() => {
    if (securityIds.length === 0) {
      setAdding(true);
    }
  }, [securityIds.length]);

  if (adding) {
    return (
      <div className="flex flex-col gap-2">
        <TextField
          name="securityId"
          isRequired
          className="w-full"
          value={draft}
          onChange={(next) => {
            setDraft(next);
            onChange(next.trim());
          }}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed) onChange(trimmed);
          }}
        >
          <Label>Security</Label>
          <Input placeholder="XEQT" autoComplete="off" />
        </TextField>
        {securityIds.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPress={() => {
              setAdding(false);
              setDraft("");
              onChange("");
            }}
          >
            Choose existing security
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <Select
      className="w-full"
      selectedKey={value || null}
      onSelectionChange={(key) => {
        if (key == null) return;
        if (String(key) === ADD_SECURITY_KEY) {
          setAdding(true);
          setDraft("");
          onChange("");
          return;
        }
        onChange(String(key));
      }}
      aria-label="Security"
    >
      <Label>Security</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {securityIds.map((id) => (
            <ListBox.Item key={id} id={id} textValue={id}>
              {id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
          <ListBox.Item id={ADD_SECURITY_KEY} textValue="Add security…">
            Add security…
            <ListBox.ItemIndicator />
          </ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
