import { allocateExact } from "../money/rationals.js";
import { sortJournals } from "../ledger/replay.js";
import { ValidationError } from "../ledger/errors.js";
import type { Account, AccountId, FacilityUse, Journal } from "../ledger/types.js";
import { FACILITY_USES, type UseSliceBalances } from "./types.js";

export type FacilitySliceState = {
  facilityAccountId: AccountId;
  facilityBalanceMinor: bigint;
  slices: UseSliceBalances;
};

export function emptyFacilitySliceState(
  facilityAccountId: AccountId,
): FacilitySliceState {
  return {
    facilityAccountId,
    facilityBalanceMinor: 0n,
    slices: {},
  };
}

export function sumSlices(slices: UseSliceBalances): bigint {
  let sum = 0n;
  for (const use of FACILITY_USES) {
    sum += slices[use] ?? 0n;
  }
  return sum;
}

function cloneSlices(slices: UseSliceBalances): UseSliceBalances {
  const next: UseSliceBalances = {};
  for (const use of FACILITY_USES) {
    const v = slices[use] ?? 0n;
    if (v !== 0n) next[use] = v;
  }
  return next;
}

function setSlice(slices: UseSliceBalances, use: FacilityUse, value: bigint): void {
  if (value < 0n) {
    throw new ValidationError(
      `Use slice ${use} would go negative`,
      "FACILITY_USE",
    );
  }
  if (value === 0n) {
    delete slices[use];
  } else {
    slices[use] = value;
  }
}

function facilityPostingMinor(journal: Journal, facilityAccountId: AccountId): bigint {
  let total = 0n;
  for (const posting of journal.postings) {
    if (posting.accountId === facilityAccountId) {
      total += posting.amount.minor;
    }
  }
  return total;
}

function assertSliceInvariant(state: FacilitySliceState): void {
  const owed = state.facilityBalanceMinor < 0n ? -state.facilityBalanceMinor : 0n;
  const sliceSum = sumSlices(state.slices);
  if (sliceSum !== owed) {
    throw new ValidationError(
      `Use-slice sum ${sliceSum} !== facility owed ${owed}`,
      "FACILITY_USE",
    );
  }
}

export function applyFacilityJournal(
  state: FacilitySliceState,
  journal: Journal,
  accounts: ReadonlyMap<AccountId, Account>,
): FacilitySliceState {
  const account = accounts.get(state.facilityAccountId);
  if (account === undefined || account.type !== "CREDIT_FACILITY") {
    throw new ValidationError(
      `Account ${state.facilityAccountId} is not a CREDIT_FACILITY`,
      "UNKNOWN_ACCOUNT",
      [journal.id],
    );
  }

  const delta = facilityPostingMinor(journal, state.facilityAccountId);
  if (delta === 0n) {
    return state;
  }

  const next: FacilitySliceState = {
    facilityAccountId: state.facilityAccountId,
    facilityBalanceMinor: state.facilityBalanceMinor + delta,
    slices: cloneSlices(state.slices),
  };

  if (delta < 0n) {
    // Liability increase: draw or capitalized interest
    const increase = -delta;
    if (journal.facilityUses && journal.facilityUses.length > 0) {
      let useSum = 0n;
      for (const line of journal.facilityUses) {
        useSum += line.amount.minor;
        setSlice(
          next.slices,
          line.use,
          (next.slices[line.use] ?? 0n) + line.amount.minor,
        );
      }
      if (useSum !== increase) {
        throw new ValidationError(
          "Facility uses must sum to facility liability increase",
          "FACILITY_USE",
          [journal.id],
        );
      }
    } else {
      // Capitalize / unlabeled increase: allocate across existing slices, else OTHER
      const weights = FACILITY_USES.map((u) => next.slices[u] ?? 0n);
      const weightSum = weights.reduce((a, b) => a + b, 0n);
      if (weightSum === 0n) {
        setSlice(next.slices, "OTHER", (next.slices.OTHER ?? 0n) + increase);
      } else {
        const parts = allocateExact(increase, weights);
        for (let i = 0; i < FACILITY_USES.length; i += 1) {
          const use = FACILITY_USES[i]!;
          const part = parts[i]!;
          if (part > 0n) {
            setSlice(next.slices, use, (next.slices[use] ?? 0n) + part);
          }
        }
      }
    }
  } else {
    // Liability decrease: repayment
    const decrease = delta;
    const currentOwed =
      state.facilityBalanceMinor < 0n ? -state.facilityBalanceMinor : 0n;
    if (decrease > currentOwed) {
      // Overpay toward positive facility balance — clear slices then leave excess
      next.slices = {};
    } else if (journal.facilityUses && journal.facilityUses.length > 0) {
      let useSum = 0n;
      for (const line of journal.facilityUses) {
        useSum += line.amount.minor;
        setSlice(
          next.slices,
          line.use,
          (next.slices[line.use] ?? 0n) - line.amount.minor,
        );
      }
      if (useSum !== decrease) {
        throw new ValidationError(
          "Facility uses must sum to facility liability decrease",
          "FACILITY_USE",
          [journal.id],
        );
      }
    } else {
      const weights = FACILITY_USES.map((u) => state.slices[u] ?? 0n);
      const parts = allocateExact(decrease, weights);
      const rebuilt: UseSliceBalances = {};
      for (let i = 0; i < FACILITY_USES.length; i += 1) {
        const use = FACILITY_USES[i]!;
        const remaining = (state.slices[use] ?? 0n) - parts[i]!;
        if (remaining < 0n) {
          throw new ValidationError(
            `Use slice ${use} would go negative`,
            "FACILITY_USE",
            [journal.id],
          );
        }
        if (remaining > 0n) rebuilt[use] = remaining;
      }
      next.slices = rebuilt;
    }
  }

  assertSliceInvariant(next);
  return next;
}

export function replayFacilitySlices(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  facilityAccountId: AccountId,
): FacilitySliceState {
  let state = emptyFacilitySliceState(facilityAccountId);
  for (const journal of sortJournals(journals)) {
    state = applyFacilityJournal(state, journal, accounts);
  }
  return state;
}

/** Closing slice state after all journals with tradeDate <= asOfDate. */
export function facilitySlicesAsOf(
  journals: readonly Journal[],
  accounts: ReadonlyMap<AccountId, Account>,
  facilityAccountId: AccountId,
  asOfDate: string,
): FacilitySliceState {
  const filtered = journals.filter(
    (j) => j.status === "POSTED" && j.tradeDate <= asOfDate,
  );
  return replayFacilitySlices(filtered, accounts, facilityAccountId);
}
