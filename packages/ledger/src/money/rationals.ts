export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Divisor must be positive");
  if (a < 0n || b < 0n) throw new Error("mulDivFloor requires non-negative operands");
  return (a * b) / d;
}

export function allocateCost(total: bigint, take: bigint, whole: bigint): bigint {
  if (whole <= 0n) throw new Error("whole must be positive");
  if (take < 0n) throw new Error("take must be non-negative");
  if (take > whole) throw new Error("take exceeds whole");
  if (total < 0n) throw new Error("total must be non-negative");
  if (take === 0n) return 0n;
  if (take === whole) return total;
  return mulDivFloor(total, take, whole);
}
