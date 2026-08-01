import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CAD,
  money,
  emptyFacilitySliceState,
  applyFacilityJournal,
  sumSlices,
} from "../src/index.js";
import type { Account, Journal } from "../src/ledger/types.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/interest/facility-draw-repay-month.json",
);

const accounts = new Map<string, Account>([
  ["facility", { id: "facility", type: "CREDIT_FACILITY", currency: "CAD" }],
  ["investment", { id: "investment", type: "INVESTMENT", currency: "CAD" }],
  ["cash", { id: "cash", type: "CASH", currency: "CAD" }],
]);

function draw(id: string, amount: bigint, use: "INVESTMENT" | "PERSONAL"): Journal {
  return {
    id,
    type: "TRANSFER",
    tradeDate: "2024-01-01",
    sortKey: Number(id.replace(/\D/g, "")) || 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "facility", amount: money(CAD, -amount) },
      { accountId: "investment", amount: money(CAD, amount) },
    ],
    facilityUses: [{ use, amount: money(CAD, amount) }],
  };
}

function repay(id: string, amount: bigint): Journal {
  return {
    id,
    type: "TRANSFER",
    tradeDate: "2024-01-15",
    sortKey: 0,
    status: "POSTED",
    source: "MANUAL",
    postings: [
      { accountId: "cash", amount: money(CAD, -amount) },
      { accountId: "facility", amount: money(CAD, amount) },
    ],
  };
}

describe("use-slice fold", () => {
  it("matches draw/repay fixture and keeps slice sum = owed", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      expectedAfterRepay: {
        facilityBalanceMinor: string;
        slices: Record<string, string>;
      };
    };

    let state = emptyFacilitySliceState("facility");
    state = applyFacilityJournal(state, draw("j1", 100000n, "INVESTMENT"), accounts);
    expect(state.facilityBalanceMinor).toBe(-100000n);
    expect(state.slices.INVESTMENT).toBe(100000n);
    expect(sumSlices(state.slices)).toBe(100000n);

    state = applyFacilityJournal(state, draw("j2", 50000n, "PERSONAL"), accounts);
    expect(state.facilityBalanceMinor).toBe(-150000n);
    expect(state.slices.INVESTMENT).toBe(100000n);
    expect(state.slices.PERSONAL).toBe(50000n);

    state = applyFacilityJournal(state, repay("j3", 60000n), accounts);
    expect(state.facilityBalanceMinor).toBe(
      BigInt(fixture.expectedAfterRepay.facilityBalanceMinor),
    );
    expect(state.slices.INVESTMENT).toBe(
      BigInt(fixture.expectedAfterRepay.slices.INVESTMENT!),
    );
    expect(state.slices.PERSONAL).toBe(
      BigInt(fixture.expectedAfterRepay.slices.PERSONAL!),
    );
    expect(sumSlices(state.slices)).toBe(-state.facilityBalanceMinor);
  });
});
