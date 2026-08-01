import { mulDivFloor } from "../money/rationals.js";
import type { RealizedGain } from "../ledger/positions.js";

export type FxDecomposition = {
  totalGainReporting: bigint;
  assetMovementReporting: bigint;
  currencyMovementReporting: bigint;
};

export function decomposeFxGain(
  gain: RealizedGain,
  reportingCurrency?: string,
): FxDecomposition {
  const totalGainReporting = gain.gainReportingMinor;

  const sameCurrency =
    reportingCurrency !== undefined
      ? gain.tradeCurrency === reportingCurrency
      : gain.proceedsTradeMinor === gain.proceedsReportingMinor &&
        gain.costTradeMinor === gain.costReportingMinor;

  if (sameCurrency) {
    return {
      totalGainReporting,
      assetMovementReporting: totalGainReporting,
      currencyMovementReporting: 0n,
    };
  }

  const assetMovementReporting =
    gain.costTradeMinor > 0n
      ? signedMulDivFloor(
          gain.gainTradeMinor,
          gain.costReportingMinor,
          gain.costTradeMinor,
        )
      : 0n;
  const currencyMovementReporting = totalGainReporting - assetMovementReporting;

  return {
    totalGainReporting,
    assetMovementReporting,
    currencyMovementReporting,
  };
}

function signedMulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Divisor must be positive");
  if (a === 0n) return 0n;
  if (a > 0n) {
    return mulDivFloor(a, b, d);
  }
  return -mulDivFloor(-a, b, d);
}
