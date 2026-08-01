import { allocateCost } from "../money/rationals.js";
import { qtyAdd, qtyIsZero, type Quantity } from "../money/quantity.js";
import { ValidationError } from "./errors.js";
import { positionKey } from "./positions-qty.js";
import type {
  AccountId,
  JournalId,
  Posting,
  SecurityId,
} from "./types.js";

export type CostBasisMethod = "ACB" | "FIFO";

export type FifoLot = {
  readonly acquiredJournalId: JournalId;
  readonly quantity: Quantity;
  readonly costTradeMinor: bigint;
  readonly costReportingMinor: bigint;
};

export type Position = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly quantity: Quantity;
  readonly tradeCurrency: string;
  readonly method: CostBasisMethod;
  readonly acbCostTradeMinor: bigint;
  readonly acbCostReportingMinor: bigint;
  readonly lots: readonly FifoLot[];
};

export type RealizedGain = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly journalId: JournalId;
  readonly quantitySold: Quantity;
  readonly tradeCurrency: string;
  readonly proceedsTradeMinor: bigint;
  readonly proceedsReportingMinor: bigint;
  readonly costTradeMinor: bigint;
  readonly costReportingMinor: bigint;
  readonly gainTradeMinor: bigint;
  readonly gainReportingMinor: bigint;
  readonly sourceJournalIds: string[];
};

export type SecurityLeg = {
  readonly accountId: AccountId;
  readonly securityId: SecurityId;
  readonly quantity: Quantity;
  readonly tradeCurrency: string;
  readonly tradeAmountMinor: bigint;
  readonly reportingAmountMinor: bigint;
};

export type PositionState = {
  positions: Map<string, Position>;
  realized: RealizedGain[];
};

export function emptyPositionState(): PositionState {
  return {
    positions: new Map(),
    realized: [],
  };
}

export function extractSecurityLegs(postings: readonly Posting[]): SecurityLeg[] {
  const legs: SecurityLeg[] = [];

  for (const posting of postings) {
    if (posting.securityId === undefined || posting.quantity === undefined) {
      continue;
    }

    const hasTradeCurrency = posting.tradeCurrency !== undefined;
    const hasTradeAmount = posting.tradeAmountMinor !== undefined;

    if (hasTradeCurrency !== hasTradeAmount) {
      throw new ValidationError(
        "Security leg requires both tradeCurrency and tradeAmountMinor, or neither",
        "MISSING_COST",
      );
    }

    const tradeCurrency = posting.tradeCurrency ?? posting.amount.currency;
    const tradeAmountMinor = posting.tradeAmountMinor ?? posting.amount.minor;

    legs.push({
      accountId: posting.accountId,
      securityId: posting.securityId,
      quantity: posting.quantity,
      tradeCurrency,
      tradeAmountMinor,
      reportingAmountMinor: posting.amount.minor,
    });
  }

  return legs;
}

export function applyPositionsForJournal(
  state: PositionState,
  journal: { id: string; postings: Posting[] },
  method: CostBasisMethod,
): PositionState {
  let positions = state.positions;
  let realized = state.realized;

  for (const leg of extractSecurityLegs(journal.postings)) {
    if (qtyIsZero(leg.quantity)) {
      continue;
    }

    if (leg.quantity.scaled > 0n) {
      const next = applyAcquire(positions, journal.id, leg, method);
      positions = next;
    } else {
      const result = applyDispose(positions, realized, journal.id, leg, method);
      positions = result.positions;
      realized = result.realized;
    }
  }

  return { positions, realized };
}

function applyAcquire(
  positions: ReadonlyMap<string, Position>,
  journalId: JournalId,
  leg: SecurityLeg,
  method: CostBasisMethod,
): Map<string, Position> {
  if (leg.tradeAmountMinor < 0n || leg.reportingAmountMinor < 0n) {
    throw new ValidationError(
      "Acquire security leg requires non-negative trade and reporting amounts",
      "COST_CURRENCY",
      [journalId],
    );
  }

  const key = positionKey(leg.accountId, leg.securityId);
  const existing = positions.get(key);
  const next = new Map(positions);

  if (existing !== undefined) {
    if (existing.tradeCurrency !== leg.tradeCurrency) {
      throw new ValidationError(
        `Trade currency mismatch for ${key}: ${existing.tradeCurrency} vs ${leg.tradeCurrency}`,
        "COST_CURRENCY",
        [journalId],
      );
    }
    if (existing.method !== method) {
      throw new ValidationError(
        `Cost basis method mismatch for ${key}`,
        "COST_CURRENCY",
        [journalId],
      );
    }

    const quantity = qtyAdd(existing.quantity, leg.quantity);
    const acbCostTradeMinor = existing.acbCostTradeMinor + leg.tradeAmountMinor;
    const acbCostReportingMinor =
      existing.acbCostReportingMinor + leg.reportingAmountMinor;

    if (method === "ACB") {
      next.set(key, {
        ...existing,
        quantity,
        acbCostTradeMinor,
        acbCostReportingMinor,
        lots: [],
      });
    } else {
      next.set(key, {
        ...existing,
        quantity,
        acbCostTradeMinor,
        acbCostReportingMinor,
        lots: [
          ...existing.lots,
          {
            acquiredJournalId: journalId,
            quantity: leg.quantity,
            costTradeMinor: leg.tradeAmountMinor,
            costReportingMinor: leg.reportingAmountMinor,
          },
        ],
      });
    }
    return next;
  }

  const position: Position = {
    accountId: leg.accountId,
    securityId: leg.securityId,
    quantity: leg.quantity,
    tradeCurrency: leg.tradeCurrency,
    method,
    acbCostTradeMinor: leg.tradeAmountMinor,
    acbCostReportingMinor: leg.reportingAmountMinor,
    lots:
      method === "FIFO"
        ? [
            {
              acquiredJournalId: journalId,
              quantity: leg.quantity,
              costTradeMinor: leg.tradeAmountMinor,
              costReportingMinor: leg.reportingAmountMinor,
            },
          ]
        : [],
  };
  next.set(key, position);
  return next;
}

function applyDispose(
  positions: ReadonlyMap<string, Position>,
  realized: readonly RealizedGain[],
  journalId: JournalId,
  leg: SecurityLeg,
  method: CostBasisMethod,
): PositionState {
  const key = positionKey(leg.accountId, leg.securityId);
  const existing = positions.get(key);
  if (existing === undefined) {
    throw new ValidationError(
      `No position to dispose for ${key}`,
      "NEGATIVE_QUANTITY",
      [journalId],
    );
  }

  if (existing.tradeCurrency !== leg.tradeCurrency) {
    throw new ValidationError(
      `Trade currency mismatch for ${key}: ${existing.tradeCurrency} vs ${leg.tradeCurrency}`,
      "COST_CURRENCY",
      [journalId],
    );
  }
  if (existing.method !== method) {
    throw new ValidationError(
      `Cost basis method mismatch for ${key}`,
      "COST_CURRENCY",
      [journalId],
    );
  }

  const sellQtyScaled = -leg.quantity.scaled;
  if (sellQtyScaled > existing.quantity.scaled) {
    throw new ValidationError(
      `Negative quantity for ${key}`,
      "NEGATIVE_QUANTITY",
      [journalId],
    );
  }

  const proceedsTradeMinor = -leg.tradeAmountMinor;
  const proceedsReportingMinor = -leg.reportingAmountMinor;
  if (proceedsTradeMinor < 0n || proceedsReportingMinor < 0n) {
    throw new ValidationError(
      "Dispose security leg requires non-positive trade and reporting amounts (proceeds >= 0)",
      "COST_CURRENCY",
      [journalId],
    );
  }

  const sellQty: Quantity = { scaled: sellQtyScaled };
  let costTradeMinor: bigint;
  let costReportingMinor: bigint;
  let sourceJournalIds: string[];
  let updated: Position | undefined;

  if (method === "ACB") {
    costTradeMinor = allocateCost(
      existing.acbCostTradeMinor,
      sellQtyScaled,
      existing.quantity.scaled,
    );
    costReportingMinor = allocateCost(
      existing.acbCostReportingMinor,
      sellQtyScaled,
      existing.quantity.scaled,
    );
    sourceJournalIds = [journalId];

    const remainingQtyScaled = existing.quantity.scaled - sellQtyScaled;
    if (remainingQtyScaled === 0n) {
      updated = undefined;
    } else {
      updated = {
        ...existing,
        quantity: { scaled: remainingQtyScaled },
        acbCostTradeMinor: existing.acbCostTradeMinor - costTradeMinor,
        acbCostReportingMinor: existing.acbCostReportingMinor - costReportingMinor,
        lots: [],
      };
    }
  } else {
    const fifo = consumeFifoLots(existing, sellQtyScaled, journalId);
    costTradeMinor = fifo.costTradeMinor;
    costReportingMinor = fifo.costReportingMinor;
    sourceJournalIds = fifo.sourceJournalIds;
    updated = fifo.position;
  }

  const gain: RealizedGain = {
    accountId: leg.accountId,
    securityId: leg.securityId,
    journalId,
    quantitySold: sellQty,
    tradeCurrency: leg.tradeCurrency,
    proceedsTradeMinor,
    proceedsReportingMinor,
    costTradeMinor,
    costReportingMinor,
    gainTradeMinor: proceedsTradeMinor - costTradeMinor,
    gainReportingMinor: proceedsReportingMinor - costReportingMinor,
    sourceJournalIds,
  };

  const nextPositions = new Map(positions);
  if (updated === undefined) {
    nextPositions.delete(key);
  } else {
    nextPositions.set(key, updated);
  }

  return {
    positions: nextPositions,
    realized: [...realized, gain],
  };
}

function consumeFifoLots(
  existing: Position,
  sellQtyScaled: bigint,
  sellJournalId: JournalId,
): {
  costTradeMinor: bigint;
  costReportingMinor: bigint;
  sourceJournalIds: string[];
  position: Position | undefined;
} {
  let remaining = sellQtyScaled;
  let costTradeMinor = 0n;
  let costReportingMinor = 0n;
  const sourceIds = new Set<string>([sellJournalId]);
  const lots: FifoLot[] = [];

  for (const lot of existing.lots) {
    if (remaining === 0n) {
      lots.push(lot);
      continue;
    }

    const take =
      remaining < lot.quantity.scaled ? remaining : lot.quantity.scaled;
    const lotCostTrade = allocateCost(lot.costTradeMinor, take, lot.quantity.scaled);
    const lotCostReporting = allocateCost(
      lot.costReportingMinor,
      take,
      lot.quantity.scaled,
    );

    costTradeMinor += lotCostTrade;
    costReportingMinor += lotCostReporting;
    sourceIds.add(lot.acquiredJournalId);
    remaining -= take;

    if (take < lot.quantity.scaled) {
      lots.push({
        acquiredJournalId: lot.acquiredJournalId,
        quantity: { scaled: lot.quantity.scaled - take },
        costTradeMinor: lot.costTradeMinor - lotCostTrade,
        costReportingMinor: lot.costReportingMinor - lotCostReporting,
      });
    }
  }

  if (remaining > 0n) {
    throw new ValidationError(
      `Insufficient FIFO lots for ${positionKey(existing.accountId, existing.securityId)}`,
      "NEGATIVE_QUANTITY",
      [sellJournalId],
    );
  }

  const remainingQtyScaled = existing.quantity.scaled - sellQtyScaled;
  if (remainingQtyScaled === 0n) {
    return {
      costTradeMinor,
      costReportingMinor,
      sourceJournalIds: [...sourceIds],
      position: undefined,
    };
  }

  return {
    costTradeMinor,
    costReportingMinor,
    sourceJournalIds: [...sourceIds],
    position: {
      ...existing,
      quantity: { scaled: remainingQtyScaled },
      acbCostTradeMinor: existing.acbCostTradeMinor - costTradeMinor,
      acbCostReportingMinor: existing.acbCostReportingMinor - costReportingMinor,
      lots,
    },
  };
}
