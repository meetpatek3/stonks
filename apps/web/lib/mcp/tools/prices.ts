import { resolvePrice } from "@stonks/ledger";
import { z } from "zod";
import { McpToolError } from "../errors";
import { defineTool } from "../registrar";
import { minorFromString, zCurrencyCode, zMinorAmount, zTradeDate } from "../schemas";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function requestedDate(asOf: string | undefined): string {
  return asOf ?? new Date().toISOString().slice(0, 10);
}

export const getPriceTool = defineTool({
  name: "get_price",
  description:
    "Resolve one security's price in its own currency. Manual overrides win over provider " +
    "quotes; the response always identifies QUOTE versus OVERRIDE, preserves the real asOf " +
    "date, and marks an older real price stale. Missing prices return PRICE_NOT_FOUND.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    securityId: z
      .string({ error: "must be a security id string" })
      .min(1, "must be a security id string"),
    currency: zCurrencyCode,
    asOf: zTradeDate.optional().describe("Requested price date (YYYY-MM-DD)."),
  },
  async handler(ctx, input) {
    const security = await ctx.repos.prices.getSecurity(input.securityId);
    if (security === null) {
      throw new McpToolError(
        "PRICE_NOT_FOUND",
        `No priceable security ${input.securityId} exists.`,
        "Check the security id and use a security id known to the ledger.",
      );
    }
    if (security.currency !== input.currency) {
      throw new McpToolError(
        "VALIDATION",
        `Security ${input.securityId} is priced in ${security.currency}, not ${input.currency}.`,
        "Pass the security's own currency; reporting-currency conversion is a separate read-model concern.",
      );
    }

    const requestedAsOf = requestedDate(input.asOf);
    const overrides = await ctx.repos.prices.listOverrides(ctx.householdId);
    const resolved = await resolvePrice({
      securityId: input.securityId,
      asOf: requestedAsOf,
      currency: security.currency,
      overrides,
      provider: {
        getQuote: (securityId, asOf, currency) =>
          ctx.repos.prices.latestQuoteAsOf(securityId, currency, asOf),
      },
    });

    if (resolved === null) {
      throw new McpToolError(
        "PRICE_NOT_FOUND",
        `No price is available for ${input.securityId} on or before ${requestedAsOf}.`,
        "Set a manual override with set_price_override or wait for a provider quote.",
      );
    }

    const source = "currency" in resolved ? "QUOTE" : "OVERRIDE";
    const asOf = resolved.asOf;
    const stale = asOf < requestedAsOf;
    return {
      content: [
        {
          type: "text",
          text: `${source} price for ${input.securityId} is ${resolved.priceMinor.toString()} ` +
            `minor units as of ${asOf}${stale ? " (stale)" : ""}.`,
        },
      ],
      structuredContent: {
        securityId: input.securityId,
        priceMinor: resolved.priceMinor.toString(),
        currency: security.currency,
        minorUnits: security.minorUnits,
        source,
        asOf,
        requestedAsOf,
        stale,
      },
    };
  },
});

export const setPriceOverrideTool = defineTool({
  name: "set_price_override",
  description:
    "Append a household-scoped manual security price. The row is never updated in place; " +
    "a later correction is another append-only override. Manual values remain visibly distinct " +
    "from provider quotes as source OVERRIDE.",
  scope: "read_write",
  annotations: ADDITIVE,
  inputSchema: {
    securityId: z
      .string({ error: "must be a security id string" })
      .min(1, "must be a security id string"),
    asOf: zTradeDate,
    priceMinor: zMinorAmount,
    currency: zCurrencyCode,
    note: z
      .string({ error: "must be a non-empty override note" })
      .min(1, "must be a non-empty override note"),
  },
  async handler(ctx, input) {
    const security = await ctx.repos.prices.getSecurity(input.securityId);
    if (security === null) {
      throw new McpToolError(
        "PRICE_NOT_FOUND",
        `No priceable security ${input.securityId} exists.`,
        "Check the security id before recording an override.",
      );
    }
    if (security.currency !== input.currency) {
      throw new McpToolError(
        "VALIDATION",
        `Security ${input.securityId} is priced in ${security.currency}, not ${input.currency}.`,
        "Record the override in the security's own currency.",
      );
    }

    await ctx.repos.prices.insertOverride(ctx.householdId, {
      securityId: input.securityId,
      asOf: input.asOf,
      priceMinor: minorFromString(input.priceMinor),
      note: input.note,
      createdBy: "mcp",
    });

    return {
      content: [
        {
          type: "text",
          text:
            `Appended an OVERRIDE price for ${input.securityId} on ${input.asOf}. ` +
            "The manual price is distinct from provider quotes.",
        },
      ],
      structuredContent: {
        override: {
          securityId: input.securityId,
          priceMinor: input.priceMinor,
          currency: security.currency,
          minorUnits: security.minorUnits,
          asOf: input.asOf,
          source: "OVERRIDE",
          note: input.note,
        },
      },
    };
  },
});

