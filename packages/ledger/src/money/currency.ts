export type CurrencyCode = string;

export type CurrencyDef = {
  readonly code: CurrencyCode;
  readonly minorUnits: number; // 0..9
};

export const CAD: CurrencyDef = { code: "CAD", minorUnits: 2 };
export const USD: CurrencyDef = { code: "USD", minorUnits: 2 };
