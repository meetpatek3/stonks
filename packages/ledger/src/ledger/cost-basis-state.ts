export type CostState = "Known" | "Unknown";

export type CostBasisState =
  | { kind: "Known"; tradeMinor: bigint; reportingMinor: bigint }
  | { kind: "Unknown" };

export function isUnknownCost(state: CostState): boolean {
  return state === "Unknown";
}
