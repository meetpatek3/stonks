import { describe, expect, it } from "vitest";
import { getInterestAttributionTool } from "@/lib/mcp/tools/borrowing";
import { invokeTool } from "@/lib/mcp/registrar";
import { makeTestCtx, assertMoneyFieldsAreStrings } from "./helpers/mcp-test-utils";

const ATTRIBUTION = {
  periodStart: "2024-01-01",
  periodEnd: "2024-01-04",
  reportingCurrency: "CAD",
  reportingMinorUnits: 2,
  investmentInterestMinor: "300",
  actualInterestJournalIds: ["interest-a"],
  allocations: [
    {
      accountId: "brokerage",
      securityId: "AAPL",
      interestMinor: "200",
      dollarDaysReporting: "300000",
      sourceJournalIds: ["buy-aapl"],
    },
    {
      accountId: "brokerage",
      securityId: "MSFT",
      interestMinor: "100",
      dollarDaysReporting: "150000",
      sourceJournalIds: ["buy-msft"],
    },
  ],
  unallocatedMinor: "0",
  uncertaintyReasons: [],
};

describe("get_interest_attribution", () => {
  it("returns actual investment interest allocated by dollar-days with minor strings", async () => {
    const calls: Array<[string, string, string]> = [];
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: {
        interest: {
          getAttribution: async (householdId, from, to) => {
            calls.push([householdId, from, to]);
            return ATTRIBUTION;
          },
        },
      },
    });

    const result = await invokeTool(getInterestAttributionTool, ctx, {
      from: "2024-01-01",
      to: "2024-01-04",
    });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      interest: { amountMinor: string; basis: string };
      allocations: Array<{
        securityId: string;
        interest: { amountMinor: string; basis: string };
        dollarDaysReporting: string;
      }>;
      unallocated: { amountMinor: string; basis: string };
    };

    assertMoneyFieldsAreStrings(out);
    expect(out.interest).toMatchObject({
      amountMinor: "300",
      currency: "CAD",
      minorUnits: 2,
      basis: "ACTUAL",
    });
    expect(out.allocations).toEqual([
      expect.objectContaining({
        securityId: "AAPL",
        interest: { amountMinor: "200", currency: "CAD", minorUnits: 2, basis: "ACTUAL" },
        dollarDaysReporting: "300000",
      }),
      expect.objectContaining({
        securityId: "MSFT",
        interest: { amountMinor: "100", currency: "CAD", minorUnits: 2, basis: "ACTUAL" },
        dollarDaysReporting: "150000",
      }),
    ]);
    expect(out.unallocated).toMatchObject({
      amountMinor: "0",
      basis: "ACTUAL",
    });
    expect(calls).toEqual([["hh-a", "2024-01-01", "2024-01-04"]]);
  });

  it("preserves an incomplete actual-interest input as null with its reason", async () => {
    const ctx = makeTestCtx({
      repos: {
        interest: {
          getAttribution: async () => ({
            ...ATTRIBUTION,
            investmentInterestMinor: null,
            allocations: [],
            unallocatedMinor: null,
            uncertaintyReasons: ["interest-a: no facility-use attribution"],
          }),
        },
      },
    });

    const result = await invokeTool(getInterestAttributionTool, ctx, {
      from: "2024-01-01",
      to: "2024-01-04",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      interest: null,
      allocations: [],
      unallocated: null,
      uncertaintyReasons: ["interest-a: no facility-use attribution"],
    });
  });

  it("rejects an empty or reversed date range as actionable input", async () => {
    const result = await invokeTool(getInterestAttributionTool, makeTestCtx(), {
      from: "2024-01-04",
      to: "2024-01-04",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(JSON.stringify(result)).toContain("periodEnd");
  });
});
