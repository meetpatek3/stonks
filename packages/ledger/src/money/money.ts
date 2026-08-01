import type { CurrencyCode, CurrencyDef } from "./currency.js";

export type Money = {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
};

export function money(currency: CurrencyDef | CurrencyCode, minor: bigint): Money {
  if (typeof minor !== "bigint") {
    throw new TypeError("Money minor units must be bigint");
  }
  const code = typeof currency === "string" ? currency : currency.code;
  return { currency: code, minor };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { currency: a.currency, minor: a.minor + b.minor };
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { currency: a.currency, minor: a.minor - b.minor };
}

export function neg(a: Money): Money {
  return { currency: a.currency, minor: -a.minor };
}

export function isZero(a: Money): boolean {
  return a.minor === 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
