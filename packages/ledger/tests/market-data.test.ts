import { describe, it, expect } from "vitest";
import { FixtureMarketDataProvider, resolvePrice } from "../src/index.js";

describe("market data", () => {
  const provider = new FixtureMarketDataProvider([
    {
      securityId: "XEQT",
      currency: "CAD",
      asOf: "2024-01-01",
      priceMinor: 3000n,
      source: "fixture",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      securityId: "XEQT",
      currency: "CAD",
      asOf: "2024-06-01",
      priceMinor: 3200n,
      source: "fixture",
      fetchedAt: "2024-06-01T00:00:00.000Z",
    },
  ]);

  it("returns latest quote on or before asOf", async () => {
    const q = await provider.getQuote("XEQT", "2024-03-01", "CAD");
    expect(q?.priceMinor).toBe(3000n);
    const q2 = await provider.getQuote("XEQT", "2024-06-15", "CAD");
    expect(q2?.priceMinor).toBe(3200n);
  });

  it("prefers overrides and never invents missing prices", async () => {
    const overridden = await resolvePrice({
      securityId: "XEQT",
      asOf: "2024-06-01",
      currency: "CAD",
      overrides: [
        {
          securityId: "XEQT",
          asOf: "2024-06-01",
          priceMinor: 3100n,
          note: "manual",
        },
      ],
      provider,
    });
    expect(overridden && "note" in overridden ? overridden.priceMinor : null).toBe(3100n);

    const missing = await resolvePrice({
      securityId: "MISSING",
      asOf: "2024-06-01",
      currency: "CAD",
      overrides: [],
      provider,
    });
    expect(missing).toBeNull();
  });
});
