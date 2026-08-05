import { z } from "zod";
import { formatReportingMoney } from "@/lib/format";
import { McpToolError } from "../errors";
import { defineTool, type McpToolContext } from "../registrar";

/**
 * Task 5 read tools — portfolio overview, accounts, positions, open items
 * (spec §8 tools 1, 2, 3, 9).
 *
 * Every figure comes from the portfolio read model (`getPortfolioSnapshot`
 * → `derivePortfolioSnapshot`), injected through `ctx.repos.portfolio`.
 * Nothing here computes a balance, cost basis, return, or interest figure;
 * the handlers select and reshape what the read model already derived.
 * Uncertainty fields (`costIsUnknown`, null-with-reason figures, stale
 * price tags, uncertainty/stale reason splits) pass through verbatim.
 */

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

async function snapshot(ctx: McpToolContext) {
  return ctx.repos.portfolio.getSnapshot(ctx.householdId);
}

export const getPortfolioOverviewTool = defineTool({
  name: "get_portfolio_overview",
  description:
    "Net worth, total invested and total borrowed (minor-unit strings in the reporting " +
    "currency), balances grouped by account type, open-item counts, the cost-based " +
    "allocation split, month-end value over time, and portfolio valuation including " +
    "market value, unrealized gain, gross return, and return net of all costs. All " +
    "figures are derived by replaying the household's posted journals.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {},
  async handler(ctx) {
    const snap = await snapshot(ctx);

    const money = (minor: string) =>
      formatReportingMoney(minor, snap.reportingCurrency ?? "???", snap.reportingMinorUnits);

    return {
      content: [
        {
          type: "text",
          text:
            `Net worth ${money(snap.netWorthMinor)} · invested ${money(snap.totalInvestedMinor)} ` +
            `· borrowed ${money(snap.totalBorrowedMinor)} (${snap.reportingCurrency ?? "unknown currency"}) ` +
            `· ${snap.openItemCounts.total} open item(s).` +
            (snap.totalsAreUncertain
              ? " Totals exclude balances that could not be converted to the reporting currency."
              : ""),
        },
      ],
      structuredContent: {
        reportingCurrency: snap.reportingCurrency ?? null,
        reportingMinorUnits: snap.reportingMinorUnits,
        netWorthMinor: snap.netWorthMinor,
        totalInvestedMinor: snap.totalInvestedMinor,
        totalBorrowedMinor: snap.totalBorrowedMinor,
        totalsAreUncertain: snap.totalsAreUncertain,
        balancesByType: snap.balancesByType,
        openItemCounts: snap.openItemCounts,
        allocation: snap.allocation,
        allocationBasis: snap.allocationBasis,
        allocationIsIncomplete: snap.allocationIsIncomplete,
        valueOverTime: snap.valueOverTime,
        valuation: snap.valuation,
      },
    };
  },
});

export const listAccountsTool = defineTool({
  name: "list_accounts",
  description:
    "The household's accounts with type, currency, tax treatment, closed-at timestamp, and " +
    "the balance derived by journal replay (minor-unit string). Closed accounts are excluded " +
    "unless includeClosed is set. An account with no postings has a real zero balance.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    includeClosed: z
      .boolean()
      .optional()
      .describe("Include closed accounts (with their closedAt). Default false."),
  },
  async handler(ctx, input) {
    const [accounts, snap] = await Promise.all([
      ctx.repos.accounts.list(ctx.householdId, {
        includeClosed: input.includeClosed ?? false,
      }),
      snapshot(ctx),
    ]);

    const balanceByAccount = new Map(snap.balances.map((row) => [row.accountId, row]));

    const rows = accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      minorUnits: account.minorUnits,
      taxTreatment: account.taxTreatment,
      // No replay row means no postings ever touched the account: the balance
      // is exactly zero — a fact, not a substituted unknown.
      balanceMinor: balanceByAccount.get(account.id)?.minor ?? "0",
      closedAt: account.closedAt,
    }));

    return {
      content: [
        {
          type: "text",
          text: `${rows.length} account(s) (${input.includeClosed ? "including" : "excluding"} closed).`,
        },
      ],
      structuredContent: { accounts: rows },
    };
  },
});

export const listPositionsTool = defineTool({
  name: "list_positions",
  description:
    "Held positions: quantity (decimal string), cost basis, realized gains to date, and " +
    "attributed borrow cost — all strings, all in the stated currencies. A position whose " +
    "cost basis is unknown carries costIsUnknown: true with dependent figures null and a " +
    "reason, never 0. Optionally filtered to one account (must belong to this household).",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    accountId: z
      .string({ error: "must be an account id string" })
      .min(1, "must be an account id string")
      .optional()
      .describe("Only positions in this account."),
  },
  async handler(ctx, input) {
    if (input.accountId !== undefined) {
      const account = await ctx.repos.accounts.getById(ctx.householdId, input.accountId);
      if (account === null) {
        throw new McpToolError(
          "UNKNOWN_ACCOUNT",
          `No account ${input.accountId} in this household.`,
          "Use list_accounts to see this household's account ids.",
        );
      }
    }

    const snap = await snapshot(ctx);
    const positions =
      input.accountId === undefined
        ? snap.positions
        : snap.positions.filter((row) => row.accountId === input.accountId);

    return {
      content: [
        {
          type: "text",
          text: `${positions.length} position(s)${input.accountId ? ` in account ${input.accountId}` : ""}.`,
        },
      ],
      structuredContent: {
        reportingCurrency: snap.reportingCurrency ?? null,
        positions,
      },
    };
  },
});

export const listOpenItemsTool = defineTool({
  name: "list_open_items",
  description:
    "Data-quality findings derived from the ledger (unknown cost basis, zero cost basis, " +
    "missing FX rate), each with its severity, message, and the position/account/journal id " +
    "it traces back to. Optionally filtered by severity.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    severity: z
      .enum(["INFO", "WARNING", "ERROR"])
      .optional()
      .describe("Only items of this severity."),
  },
  async handler(ctx, input) {
    const snap = await snapshot(ctx);
    const openItems =
      input.severity === undefined
        ? snap.openItems
        : snap.openItems.filter((item) => item.severity === input.severity);

    return {
      content: [
        {
          type: "text",
          text:
            `${openItems.length} open item(s)` +
            (input.severity ? ` at severity ${input.severity}` : "") +
            ` (${snap.openItemCounts.total} total).`,
        },
      ],
      structuredContent: {
        openItems,
        counts: snap.openItemCounts,
      },
    };
  },
});
