import { z } from "zod";
import { defineTool } from "../registrar";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const DISCLAIMER = "This is not tax advice.";

export const getTaxYearSummaryTool = defineTool({
  name: "get_tax_year_summary",
  description:
    "Return the Canadian tax-year summary from the ledger read model. Tax figures are " +
    "minor-unit strings; TaxFlag entries and uncertainty reasons are informational and are " +
    "never silently applied. This is not tax advice.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    year: z
      .number({ error: "must be an integer tax year" })
      .int("must be an integer tax year")
      .min(1900, "must be a four-digit tax year")
      .max(9999, "must be a four-digit tax year"),
    jurisdiction: z
      .enum(["CA"])
      .optional()
      .default("CA")
      .describe("Tax jurisdiction; only Canada (CA) is currently supported."),
  },
  async handler(ctx, input) {
    const snapshot = await ctx.repos.portfolio.getSnapshot(ctx.householdId, {
      taxYear: input.year,
    });
    const summary = snapshot.taxSummary;
    const uncertaintyReasons =
      summary?.uncertaintyReasons ??
      [`No posted journals cover tax year ${input.year}; no tax summary can be derived.`];

    return {
      content: [
        {
          type: "text",
          text:
            summary === null
              ? `No tax summary is derivable for ${input.year}. ${DISCLAIMER}`
              : `Canadian tax summary for ${summary.year}.` +
                (summary.isUncertain
                  ? " The figures are uncertain; see uncertaintyReasons."
                  : "") +
                ` ${DISCLAIMER}`,
        },
      ],
      structuredContent: {
        reportingCurrency: snapshot.reportingCurrency ?? null,
        reportingMinorUnits: snapshot.reportingMinorUnits,
        summary,
        flags: summary?.flags ?? [],
        disclaimer: DISCLAIMER,
        isUncertain: summary === null ? true : summary.isUncertain,
        uncertaintyReasons,
      },
    };
  },
});
