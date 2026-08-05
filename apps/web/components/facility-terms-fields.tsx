"use client";

import type { DayCount, PostingDayRule } from "@stonks/ledger";
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  TextField,
  useOverlayState,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { todayIsoDate } from "@/lib/journals";

const DAY_COUNTS: ReadonlyArray<{ value: DayCount; label: string }> = [
  { value: "ACT_365", label: "ACT/365" },
  { value: "ACT_360", label: "ACT/360" },
  { value: "ACT_ACT", label: "ACT/ACT" },
];

const POSTING_RULES: ReadonlyArray<{ value: PostingDayRule; label: string }> = [
  { value: "CALENDAR_DAY", label: "Calendar day" },
  { value: "MONTH_END", label: "Month end" },
];

const CREATE_BENCHMARK_KEY = "__CREATE__";

type BenchmarkOption = { id: string; name: string };

type RatePoint = { effectiveDate: string; rateBps: number };

type FacilityTermsDialogProps = {
  accountId: string;
  accountName: string;
};

export function FacilityTermsDialog({
  accountId,
  accountName,
}: FacilityTermsDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkOption[]>([]);
  const [benchmarkId, setBenchmarkId] = useState("");
  const [creatingBenchmark, setCreatingBenchmark] = useState(false);
  const [newBenchmarkName, setNewBenchmarkName] = useState("");
  const [spreadBps, setSpreadBps] = useState("50");
  const [dayCount, setDayCount] = useState<DayCount>("ACT_365");
  const [postingDayRule, setPostingDayRule] =
    useState<PostingDayRule>("MONTH_END");
  const [capitalizeInterest, setCapitalizeInterest] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
  const [points, setPoints] = useState<RatePoint[]>([]);
  const [pointDate, setPointDate] = useState(todayIsoDate());
  const [pointRateBps, setPointRateBps] = useState("");

  const dialog = useOverlayState({
    onOpenChange(isOpen) {
      if (!isOpen) {
        setError(null);
        setCreatingBenchmark(false);
        setNewBenchmarkName("");
        setPointRateBps("");
      }
    },
  });

  const load = useCallback(async () => {
    setError(null);
    const [benchRes, termsRes] = await Promise.all([
      fetch("/api/benchmarks"),
      fetch(`/api/accounts/${accountId}/facility-terms`),
    ]);
    if (!benchRes.ok || !termsRes.ok) {
      setError("Could not load facility terms");
      return;
    }
    const benchBody = (await benchRes.json()) as {
      benchmarks: BenchmarkOption[];
    };
    const termsBody = (await termsRes.json()) as {
      terms: {
        benchmarkId: string;
        spreadBps: number;
        dayCount: DayCount;
        postingDayRule: PostingDayRule;
        capitalizeInterest: boolean;
        effectiveFrom: string;
      } | null;
      benchmark: { id: string; name: string; points: RatePoint[] } | null;
    };

    setBenchmarks(benchBody.benchmarks);
    if (termsBody.terms) {
      setBenchmarkId(termsBody.terms.benchmarkId);
      setSpreadBps(String(termsBody.terms.spreadBps));
      setDayCount(termsBody.terms.dayCount);
      setPostingDayRule(termsBody.terms.postingDayRule);
      setCapitalizeInterest(termsBody.terms.capitalizeInterest);
      setEffectiveFrom(todayIsoDate());
      setPoints(termsBody.benchmark?.points ?? []);
    } else {
      setBenchmarkId(benchBody.benchmarks[0]?.id ?? "");
      setSpreadBps("50");
      setDayCount("ACT_365");
      setPostingDayRule("MONTH_END");
      setCapitalizeInterest(true);
      setEffectiveFrom(todayIsoDate());
      setPoints([]);
    }
  }, [accountId]);

  useEffect(() => {
    if (dialog.isOpen) {
      void load();
    }
  }, [dialog.isOpen, load]);

  async function createBenchmarkInline(): Promise<string | null> {
    const name = newBenchmarkName.trim();
    if (!name) {
      setError("Benchmark name is required");
      return null;
    }
    const response = await fetch("/api/benchmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json().catch(() => null)) as
      | { id?: string; name?: string; error?: string }
      | null;
    if (!response.ok || !body?.id) {
      setError(body?.error ?? "Could not create benchmark");
      return null;
    }
    setBenchmarks((prev) => [...prev, { id: body.id!, name: body.name ?? name }]);
    setBenchmarkId(body.id);
    setCreatingBenchmark(false);
    setNewBenchmarkName("");
    setPoints([]);
    return body.id;
  }

  async function addRatePoint(): Promise<void> {
    const id = benchmarkId;
    if (!id) {
      setError("Choose a benchmark first");
      return;
    }
    const rate = Number(pointRateBps);
    if (!Number.isInteger(rate)) {
      setError("Rate must be an integer in basis points");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/benchmarks/${id}/points`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveDate: pointDate, rateBps: rate }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not save rate point");
        return;
      }
      setPoints((prev) => {
        const next = prev.filter((p) => p.effectiveDate !== pointDate);
        next.push({ effectiveDate: pointDate, rateBps: rate });
        next.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
        return next;
      });
      setPointRateBps("");
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  async function saveTerms(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      let activeBenchmarkId = benchmarkId;
      if (creatingBenchmark) {
        const createdId = await createBenchmarkInline();
        if (!createdId) return;
        activeBenchmarkId = createdId;
      }
      if (!activeBenchmarkId) {
        setError("Choose or create a benchmark");
        return;
      }
      const spread = Number(spreadBps);
      if (!Number.isInteger(spread)) {
        setError("Spread must be an integer in basis points");
        return;
      }

      const response = await fetch(`/api/accounts/${accountId}/facility-terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmarkId: activeBenchmarkId,
          spreadBps: spread,
          dayCount,
          postingDayRule,
          capitalizeInterest,
          effectiveFrom,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not save facility terms");
        return;
      }
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
        <Button size="sm" variant="secondary">
          Terms
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <form onSubmit={saveTerms}>
              <Modal.Header>
                <Modal.Heading>Facility terms — {accountName}</Modal.Heading>
                <Modal.CloseTrigger isDisabled={pending} />
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                {creatingBenchmark ? (
                  <TextField
                    className="w-full"
                    value={newBenchmarkName}
                    onChange={setNewBenchmarkName}
                    isRequired
                  >
                    <Label>New benchmark name</Label>
                    <Input placeholder="e.g. TD Prime" autoComplete="off" />
                  </TextField>
                ) : (
                  <Select
                    className="w-full"
                    selectedKey={benchmarkId || null}
                    onSelectionChange={(key) => {
                      if (key == null) return;
                      if (String(key) === CREATE_BENCHMARK_KEY) {
                        setCreatingBenchmark(true);
                        setBenchmarkId("");
                        setPoints([]);
                        return;
                      }
                      const id = String(key);
                      setBenchmarkId(id);
                      void (async () => {
                        const res = await fetch(`/api/benchmarks/${id}/points`);
                        if (!res.ok) {
                          setPoints([]);
                          return;
                        }
                        const body = (await res.json()) as { points: RatePoint[] };
                        setPoints(body.points ?? []);
                      })();
                    }}
                    aria-label="Benchmark"
                  >
                    <Label>Benchmark</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {benchmarks.map((b) => (
                          <ListBox.Item key={b.id} id={b.id} textValue={b.name}>
                            {b.name}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                        <ListBox.Item
                          id={CREATE_BENCHMARK_KEY}
                          textValue="Create benchmark…"
                        >
                          Create benchmark…
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}

                {creatingBenchmark ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setCreatingBenchmark(false);
                      setNewBenchmarkName("");
                    }}
                  >
                    Choose existing benchmark
                  </Button>
                ) : null}

                <TextField
                  className="w-full"
                  value={spreadBps}
                  onChange={setSpreadBps}
                  isRequired
                >
                  <Label>Spread (basis points)</Label>
                  <Input inputMode="numeric" placeholder="50" autoComplete="off" />
                </TextField>

                <Select
                  className="w-full"
                  selectedKey={dayCount}
                  onSelectionChange={(key) => {
                    if (key != null) setDayCount(String(key) as DayCount);
                  }}
                  aria-label="Day count"
                >
                  <Label>Day count</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {DAY_COUNTS.map((option) => (
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
                  selectedKey={postingDayRule}
                  onSelectionChange={(key) => {
                    if (key != null) setPostingDayRule(String(key) as PostingDayRule);
                  }}
                  aria-label="Posting day rule"
                >
                  <Label>Posting day rule</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {POSTING_RULES.map((option) => (
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

                <Switch
                  isSelected={capitalizeInterest}
                  onChange={setCapitalizeInterest}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>Capitalize interest</Label>
                  </Switch.Content>
                </Switch>

                <TextField
                  className="w-full"
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  isRequired
                >
                  <Label>Effective from</Label>
                  <Input type="date" />
                </TextField>

                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">
                    Benchmark rate points
                  </p>
                  {points.length === 0 ? (
                    <p className="text-sm text-muted">
                      No rate points yet. Add the current prime (or other) rate
                      in basis points.
                    </p>
                  ) : (
                    <ul className="text-sm text-foreground">
                      {points.map((point) => (
                        <li key={point.effectiveDate}>
                          {point.effectiveDate}: {point.rateBps} bps
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <TextField
                      className="min-w-[9rem] flex-1"
                      value={pointDate}
                      onChange={setPointDate}
                    >
                      <Label>Date</Label>
                      <Input type="date" />
                    </TextField>
                    <TextField
                      className="min-w-[9rem] flex-1"
                      value={pointRateBps}
                      onChange={setPointRateBps}
                    >
                      <Label>Rate (bps)</Label>
                      <Input
                        inputMode="numeric"
                        placeholder="500"
                        autoComplete="off"
                      />
                    </TextField>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      isDisabled={pending || !benchmarkId}
                      onPress={() => {
                        void addRatePoint();
                      }}
                    >
                      Add point
                    </Button>
                  </div>
                </div>

                {error ? <p className="text-sm text-danger">{error}</p> : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={pending}
                  onPress={() => dialog.close()}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" isPending={pending}>
                  Save terms
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
