"use client";

import { Button, Input, Label, ListBox, Select, TextField } from "@heroui/react";
import { useState, useTransition } from "react";

const journalTypes = [
  "BUY",
  "SELL",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER",
  "DIVIDEND",
  "INTEREST_CHARGED",
  "FEE",
] as const;

export default function EntryPage() {
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="max-w-xl animate-rise">
      <h1 className="font-display text-4xl text-white">Fast entry</h1>
      <p className="mt-2 text-[var(--color-fog)]">
        Capture a journal in under fifteen seconds. Demo mode keeps entries local for this session.
      </p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          });
        }}
      >
        <Select className="w-full" name="type" defaultSelectedKey="BUY" placeholder="Select type">
          <Label>Journal type</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {journalTypes.map((t) => (
                <ListBox.Item key={t} id={t} textValue={t}>
                  {t}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <TextField name="tradeDate" isRequired className="w-full">
          <Label>Trade date</Label>
          <Input type="date" defaultValue="2024-06-01" />
        </TextField>

        <TextField name="amount" isRequired className="w-full">
          <Label>Amount (CAD)</Label>
          <Input inputMode="decimal" placeholder="1000.00" />
        </TextField>

        <TextField name="symbol" className="w-full">
          <Label>Symbol (optional)</Label>
          <Input placeholder="XEQT" />
        </TextField>

        <TextField name="memo" className="w-full">
          <Label>Memo</Label>
          <Input placeholder="What happened" />
        </TextField>

        <Button
          type="submit"
          isPending={pending}
          className="bg-[var(--color-mint)] text-[var(--color-ink)]"
        >
          Post journal
        </Button>

        {saved ? (
          <p className="text-sm text-[var(--color-mint)]">
            Queued in demo mode — connect Postgres to persist.
          </p>
        ) : null}
      </form>
    </div>
  );
}
