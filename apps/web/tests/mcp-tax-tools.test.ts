import { describe, expect, it } from "vitest";
import type { TaxSummary } from "@/lib/portfolio-shared";
import { getTaxYearSummaryTool } from "@/lib/mcp/tools/tax";
import { invokeTool } from "@/lib/mcp/registrar";
import { makeTestCtx, assertMoneyFieldsAreStrings } from "./helpers/mcp-test-utils";

const TAX_SUMMARY: TaxSummary = {
  jurisdiction: "CA",
  year: 2024,
  realizedGainsMinor: "15000",
  realizedLossesMinor: "3000",
  taxableCapitalGainsMinor: "6000",
  inclusionRateBps: 5000,
  dividendIncomeMinor: "2000",
  interestIncomeMinor: "500",
  deductibleInterestExpenseMinor: "1000",
  flags: [
    {
      code: "SUPERFICIAL_LOSS",
      message: "Review the repurchase window.",
      journalIds: ["sell-1"],
    },
  ],
  disclaimer: "These figures are computational aids. This is not tax advice.",
  isUncertain: false,
  uncertaintyReasons: [],
};

describe("get_tax_year_summary", () => {
  it("returns minor-string tax figures, flags verbatim, and the fixed disclaimer", async () => {
    const calls: Array<{ householdId: string; options?: unknown }> = [];
    const ctx = makeTestCtx({
      householdId: "hh-a",
      repos: {
        portfolio: {
          getSnapshot: async (householdId, options) => {
            calls.push({ householdId, options });
            return {
              ...(await makeTestCtx().repos.portfolio.getSnapshot(householdId)),
              ...(await Promise.resolve({ taxSummary: TAX_SUMMARY })),
            };
          },
        },
      },
    });

    const result = await invokeTool(getTaxYearSummaryTool, ctx, {
      year: 2024,
      jurisdiction: "CA",
    });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      summary: TaxSummary;
      flags: TaxSummary["flags"];
      disclaimer: string;
    };
    assertMoneyFieldsAreStrings(out);
    expect(out.summary).toEqual(TAX_SUMMARY);
    expect(out.flags).toBe(TAX_SUMMARY.flags);
    expect(out.disclaimer).toBe("This is not tax advice.");
    expect(result.content[0]?.text).toContain("This is not tax advice.");
    expect(calls).toEqual([{ householdId: "hh-a", options: { taxYear: 2024 } }]);
  });

  it("keeps an out-of-range tax year uncertain instead of turning it into confident zeroes", async () => {
    const outsideRange: TaxSummary = {
      ...TAX_SUMMARY,
      year: 2030,
      realizedGainsMinor: "0",
      realizedLossesMinor: "0",
      taxableCapitalGainsMinor: "0",
      dividendIncomeMinor: "0",
      interestIncomeMinor: "0",
      deductibleInterestExpenseMinor: "0",
      isUncertain: true,
      uncertaintyReasons: [
        "2030 is outside the years this ledger covers (2024 to 2024).",
      ],
    };
    const ctx = makeTestCtx({
      repos: {
        portfolio: {
          getSnapshot: async () => ({
            ...(await makeTestCtx().repos.portfolio.getSnapshot("hh-a")),
            taxSummary: outsideRange,
          }),
        },
      },
    });

    const result = await invokeTool(getTaxYearSummaryTool, ctx, {
      year: 2030,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      summary: {
        year: 2030,
        isUncertain: true,
        uncertaintyReasons: outsideRange.uncertaintyReasons,
        realizedGainsMinor: "0",
      },
    });
    expect(JSON.stringify(result)).toContain("outside the years");
  });
});
