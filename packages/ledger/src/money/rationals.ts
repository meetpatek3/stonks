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

/**
 * Split `total` into parts proportional to `weights` using Hamilton largest-remainder.
 * Parts always sum to `total` exactly.
 */
export function allocateExact(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) {
    if (total === 0n) return [];
    throw new Error("Cannot allocate non-zero total to zero weights");
  }

  for (const w of weights) {
    if (w < 0n) throw new Error("Weights must be non-negative");
  }

  if (total < 0n) throw new Error("total must be non-negative");

  let sumW = 0n;
  for (const w of weights) sumW += w;

  if (sumW === 0n) {
    if (total === 0n) return weights.map(() => 0n);
    throw new Error("Cannot allocate non-zero total when all weights are zero");
  }

  const parts: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let assigned = 0n;

  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i]!;
    const numerator = total * w;
    const part = numerator / sumW;
    const remainder = numerator % sumW;
    parts.push(part);
    assigned += part;
    remainders.push({ index: i, remainder });
  }

  let leftover = total - assigned;
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });

  for (let i = 0; i < remainders.length && leftover > 0n; i += 1) {
    const idx = remainders[i]!.index;
    parts[idx] = parts[idx]! + 1n;
    leftover -= 1n;
  }

  return parts;
}
