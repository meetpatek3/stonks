export type TaxFlagCode = "SUPERFICIAL_LOSS" | "CONTRIBUTION_LIMIT" | "OTHER";

export type TaxFlag = {
  code: TaxFlagCode;
  message: string;
  journalIds?: string[];
};

export type TaxYearSummary = {
  jurisdiction: "CA";
  year: number;
  realizedGainsReportingMinor: bigint;
  realizedLossesReportingMinor: bigint;
  taxableCapitalGainsMinor: bigint;
  inclusionRateBps: number;
  dividendIncomeMinor: bigint;
  interestIncomeMinor: bigint;
  deductibleInterestExpenseMinor: bigint;
  flags: TaxFlag[];
  disclaimer: string;
};

export type CanadaTaxYearArgs = {
  year: number;
  realizedGains: Array<{
    gainReportingMinor: bigint;
    tradeDate: string;
    journalId: string;
  }>;
  dividendIncomeMinor: bigint;
  interestIncomeMinor: bigint;
  deductibleInvestmentInterestMinor: bigint;
  inclusionRateBps?: number;
  superficialLossCandidates?: Array<{ journalId: string; message?: string }>;
};

export interface JurisdictionModule<TArgs = unknown> {
  jurisdiction: string;
  summarizeYear: (args: TArgs) => TaxYearSummary;
}
