export { CAD, USD } from "./money/currency.js";
export type { CurrencyCode, CurrencyDef } from "./money/currency.js";

export { money, add, sub, neg, isZero, compare, formatMinor } from "./money/money.js";
export type { Money } from "./money/money.js";

export {
  QUANTITY_SCALE,
  qtyFromDecimalString,
  qtyToDecimalString,
  qtyAdd,
  qtySub,
  qtyNeg,
  qtyCompare,
  qtyIsZero,
} from "./money/quantity.js";
export type { Quantity } from "./money/quantity.js";

export { mulDivFloor, allocateCost, allocateExact } from "./money/rationals.js";

export { ValidationError } from "./ledger/errors.js";

export type {
  AccountType,
  JournalType,
  JournalStatus,
  JournalSource,
  FacilityUse,
  AccountId,
  SecurityId,
  JournalId,
  Posting,
  FacilityUseLine,
  Journal,
  Account,
} from "./ledger/types.js";

export { assertJournalBalanced, assertFacilityUseComplete } from "./ledger/journal.js";

export { positionKey } from "./ledger/positions-qty.js";

export {
  emptyPositionState,
  extractSecurityLegs,
  applyPositionsForJournal,
} from "./ledger/positions.js";
export type {
  CostBasisMethod,
  FifoLot,
  Position,
  RealizedGain,
  SecurityLeg,
  PositionState,
} from "./ledger/positions.js";

export {
  emptyLedgerState,
  sortJournals,
  applyJournal,
  replay,
} from "./ledger/replay.js";
export type { LedgerState, ReplayOptions } from "./ledger/replay.js";

export {
  dayCountDenominator,
  calendarDaysBetween,
  addCalendarDays,
} from "./interest/day-count.js";

export {
  emptyFacilitySliceState,
  applyFacilityJournal,
  replayFacilitySlices,
  facilitySlicesAsOf,
  sumSlices,
} from "./interest/use-slices.js";
export type { FacilitySliceState } from "./interest/use-slices.js";

export { rateBpsOnDate, modelInterest } from "./interest/accrue.js";

export { actualInterestCharged, interestVariance } from "./interest/variance.js";

export type {
  DayCount,
  PostingDayRule,
  UseSliceBalances,
  BenchmarkRatePoint,
  FacilityTerms,
  InterestDaySlice,
  InterestModelResult,
  InterestVariance,
} from "./interest/types.js";
export { FACILITY_USES } from "./interest/types.js";

export type {
  TaxFlagCode,
  TaxFlag,
  TaxYearSummary,
  CanadaTaxYearArgs,
  JurisdictionModule,
} from "./tax/types.js";
export { summarizeCanadaTaxYear, CanadaJurisdiction } from "./tax/canada.js";
