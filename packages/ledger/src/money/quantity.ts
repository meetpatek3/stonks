export const QUANTITY_SCALE = 8;

const SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

export type Quantity = {
  readonly scaled: bigint;
};

export function qtyFromDecimalString(s: string): Quantity {
  const trimmed = s.trim();
  if (trimmed === "") {
    throw new Error("Invalid quantity: empty string");
  }

  let rest = trimmed;
  let negative = false;

  if (rest.startsWith("-")) {
    negative = true;
    rest = rest.slice(1);
  } else if (rest.startsWith("+")) {
    rest = rest.slice(1);
  }

  if (rest === "") {
    throw new Error("Invalid quantity: missing digits");
  }

  const dotIndex = rest.indexOf(".");
  let intPart: string;
  let fracPart: string;

  if (dotIndex === -1) {
    intPart = rest;
    fracPart = "";
  } else {
    intPart = rest.slice(0, dotIndex);
    fracPart = rest.slice(dotIndex + 1);
    if (rest.indexOf(".", dotIndex + 1) !== -1) {
      throw new Error("Invalid quantity: multiple decimal points");
    }
  }

  if (intPart === "") {
    intPart = "0";
  }

  if (!/^\d+$/.test(intPart) || (fracPart !== "" && !/^\d+$/.test(fracPart))) {
    throw new Error("Invalid quantity: non-numeric characters");
  }

  if (fracPart.length > QUANTITY_SCALE) {
    throw new Error(`Quantity precision exceeds ${QUANTITY_SCALE} decimal places`);
  }

  const paddedFrac = fracPart.padEnd(QUANTITY_SCALE, "0");
  const scaled = BigInt(intPart + paddedFrac);
  return { scaled: negative ? -scaled : scaled };
}

export function qtyToDecimalString(q: Quantity): string {
  const sign = q.scaled < 0n ? "-" : "";
  const absScaled = q.scaled < 0n ? -q.scaled : q.scaled;
  const whole = absScaled / SCALE_FACTOR;
  const frac = absScaled % SCALE_FACTOR;
  const fracStr = frac.toString().padStart(QUANTITY_SCALE, "0");
  return `${sign}${whole}.${fracStr}`;
}

export function qtyAdd(a: Quantity, b: Quantity): Quantity {
  return { scaled: a.scaled + b.scaled };
}

export function qtySub(a: Quantity, b: Quantity): Quantity {
  return { scaled: a.scaled - b.scaled };
}

export function qtyNeg(a: Quantity): Quantity {
  return { scaled: -a.scaled };
}

export function qtyIsZero(a: Quantity): boolean {
  return a.scaled === 0n;
}

export function qtyCompare(a: Quantity, b: Quantity): -1 | 0 | 1 {
  if (a.scaled < b.scaled) return -1;
  if (a.scaled > b.scaled) return 1;
  return 0;
}
