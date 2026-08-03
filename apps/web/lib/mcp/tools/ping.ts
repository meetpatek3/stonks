import { defineTool } from "../registrar";

/**
 * `ping` — the pipeline proof for the scaffold: bearer auth → household-scoped
 * repo call → structured result. It reads the household's reporting currency
 * through the injected repo, so a live call exercises the same DB scoping
 * every later tool depends on.
 */
export const pingTool = defineTool({
  name: "ping",
  description:
    "Check connectivity and auth. Returns the server name and the household's reporting currency.",
  scope: "read",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {},
  async handler(ctx) {
    const reportingCurrency = await ctx.repos.household.getReportingCurrency(
      ctx.householdId,
    );
    if (reportingCurrency === null) {
      // A verified token implies the household exists; reaching this means the
      // row vanished mid-request — an operator-visible anomaly, not input error.
      throw new Error(`Household row missing for authenticated household ${ctx.householdId}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `pong — stonks MCP server; household reporting currency ${reportingCurrency}`,
        },
      ],
      structuredContent: {
        server: "stonks",
        reportingCurrency,
      },
    };
  },
});
