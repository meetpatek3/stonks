import { mulDivFloor } from "../money/rationals.js";
import type {
  CanadaTaxYearArgs,
  JurisdictionModule,
  TaxFlag,
  TaxYearSummary,
} from "./types.js";

const DEFAULT_INCLUSION_RATE_BPS = 5000;
const DISCLAIMER =
  "These figures are computational aids from user-provided data. This is not tax advice.";

export function summarizeCanadaTaxYear(args: CanadaTaxYearArgs): TaxYearSummary {
  let realizedGainsReportingMinor = 0n;
  let realizedLossesReportingMinor = 0n;

  for (const gain of args.realizedGains) {
    if (gain.gainReportingMinor > 0n) {
      realizedGainsReportingMinor += gain.gainReportingMinor;
    } else if (gain.gainReportingMinor < 0n) {
      realizedLossesReportingMinor += -gain.gainReportingMinor;
    }
  }

  const netGains =
    realizedGainsReportingMinor > realizedLossesReportingMinor
      ? realizedGainsReportingMinor - realizedLossesReportingMinor
      : 0n;

  const inclusionRateBps = args.inclusionRateBps ?? DEFAULT_INCLUSION_RATE_BPS;
  const taxableCapitalGainsMinor = mulDivFloor(
    netGains,
    BigInt(inclusionRateBps),
    10000n,
  );

  const flags: TaxFlag[] = [];
  for (const candidate of args.superficialLossCandidates ?? []) {
    flags.push({
      code: "SUPERFICIAL_LOSS",
      message: candidate.message ?? "Potential superficial loss — review required",
      journalIds: [candidate.journalId],
    });
  }

  return {
    jurisdiction: "CA",
    year: args.year,
    realizedGainsReportingMinor,
    realizedLossesReportingMinor,
    taxableCapitalGainsMinor,
    inclusionRateBps,
    dividendIncomeMinor: args.dividendIncomeMinor,
    interestIncomeMinor: args.interestIncomeMinor,
    deductibleInterestExpenseMinor: args.deductibleInvestmentInterestMinor,
    flags,
    disclaimer: DISCLAIMER,
  };
}

export const CanadaJurisdiction: JurisdictionModule<CanadaTaxYearArgs> = {
  jurisdiction: "CA",
  summarizeYear: summarizeCanadaTaxYear,
};
