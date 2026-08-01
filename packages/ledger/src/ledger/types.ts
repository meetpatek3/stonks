import type { Money } from "../money/money.js";
import type { Quantity } from "../money/quantity.js";

export type AccountType =
  | "INVESTMENT"
  | "CREDIT_FACILITY"
  | "RECEIVABLE"
  | "CASH"
  | "EXTERNAL";

export type JournalType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "INTEREST_CHARGED"
  | "INTEREST_EARNED"
  | "FEE"
  | "TRANSFER"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "CORPORATE_ACTION"
  | "OPENING";

export type JournalStatus = "POSTED" | "SUPERSEDED";
export type JournalSource = "MANUAL" | "IMPORT" | "SYSTEM";

export type FacilityUse = "INVESTMENT" | "LENDING" | "PERSONAL" | "OTHER";

export type AccountId = string;
export type SecurityId = string;
export type JournalId = string;

export type Posting = {
  accountId: AccountId;
  amount: Money;
  quantity?: Quantity;
  securityId?: SecurityId;
  tradeCurrency?: string;
  tradeAmountMinor?: bigint;
  fxRateN?: bigint;
  fxRateD?: bigint;
};

export type FacilityUseLine = {
  use: FacilityUse;
  amount: Money;
};

export type CorporateAction =
  | { kind: "SPLIT"; ratioN: bigint; ratioD: bigint }
  | { kind: "RETURN_OF_CAPITAL"; reportingMinor: bigint; tradeMinor: bigint };

export type Journal = {
  id: JournalId;
  type: JournalType;
  tradeDate: string;
  sortKey: number;
  status: JournalStatus;
  source: JournalSource;
  memo?: string;
  externalNaturalKey?: string;
  supersedesJournalId?: JournalId;
  postings: Posting[];
  facilityUses?: FacilityUseLine[];
  corporateAction?: CorporateAction;
};

export type Account = {
  id: AccountId;
  type: AccountType;
  currency: string;
};
