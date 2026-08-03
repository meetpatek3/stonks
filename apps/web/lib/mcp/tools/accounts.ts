import type { AccountRecord } from "@stonks/db";
import { z } from "zod";
import { McpToolError } from "../errors";
import { defineTool, type McpToolContext } from "../registrar";
import { zCurrencyCode } from "../schemas";

/**
 * Task 8 account tools — create_account and close_account (spec §8 tools
 * 15–16).
 *
 * - `create_account` is an additive write: type is validated against the five
 *   domain account types, currency against the known `currency` rows.
 * - `close_account` is hard to reverse: it requires `confirm: true` and
 *   returns a preview (mutating nothing) without it. It refuses while the
 *   account's REPLAY balance is non-zero, naming the balance — the figure
 *   comes from the portfolio read model, never a stored value, and the tool
 *   never accepts one.
 * - Every account id is looked up household-scoped; a foreign id is
 *   indistinguishable from an unknown one.
 */

const ACCOUNT_TYPES = ["INVESTMENT", "CREDIT_FACILITY", "RECEIVABLE", "CASH", "EXTERNAL"] as const;

const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const HARD_TO_REVERSE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function accountToWire(record: AccountRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    currency: record.currency,
    minorUnits: record.minorUnits,
    taxTreatment: record.taxTreatment,
    closedAt: record.closedAt,
  };
}

export const createAccountTool = defineTool({
  name: "create_account",
  description:
    "Create an account: name, type (INVESTMENT, CREDIT_FACILITY, RECEIVABLE, CASH, or " +
    "EXTERNAL), currency (must be a known ISO currency), and optional tax treatment. " +
    "Additive; the new account starts with a real zero replay balance.",
  scope: "read_write",
  annotations: ADDITIVE,
  inputSchema: {
    name: z.string({ error: "must be a non-empty account name" }).min(1, "must be a non-empty account name"),
    type: z.enum(ACCOUNT_TYPES),
    currency: zCurrencyCode,
    taxTreatment: z
      .string({ error: "must be a tax treatment string" })
      .min(1, "must be a tax treatment string")
      .optional()
      .describe('e.g. "TFSA", "RRSP"; omit when not applicable.'),
  },
  async handler(ctx, input) {
    const known = await ctx.repos.accounts.getCurrency(input.currency);
    if (known === null) {
      throw new McpToolError(
        "VALIDATION",
        `Unknown currency "${input.currency}" — the currency table has no such code.`,
        "Ask the user which ISO currency to use; currencies are seeded by the app operator.",
      );
    }

    const created = await ctx.repos.accounts.create(ctx.householdId, {
      name: input.name,
      type: input.type,
      currency: input.currency,
      ...(input.taxTreatment === undefined ? {} : { taxTreatment: input.taxTreatment }),
    });

    return {
      content: [
        {
          type: "text",
          text: `Created ${created.type} account "${created.name}" (${created.currency}) with id ${created.id}.`,
        },
      ],
      structuredContent: { account: accountToWire(created) },
    };
  },
});

/** The replay balance for one account — a derived figure, never stored. */
async function replayBalanceMinor(ctx: McpToolContext, accountId: string) {
  const snap = await ctx.repos.portfolio.getSnapshot(ctx.householdId);
  const row = snap.balances.find((balance) => balance.accountId === accountId);
  // No replay row means no postings ever touched the account: exactly zero.
  return { minor: row?.minor ?? "0", currency: row?.currency ?? null };
}

export const closeAccountTool = defineTool({
  name: "close_account",
  description:
    "Close an account by stamping closed_at. HARD TO REVERSE: requires confirm: true; " +
    "without it the tool returns a preview and mutates nothing. Refuses while the account's " +
    "replay balance is non-zero, naming the balance — move the funds first and close then.",
  scope: "read_write",
  annotations: HARD_TO_REVERSE,
  inputSchema: {
    accountId: z
      .string({ error: "must be an account id string" })
      .min(1, "must be an account id string"),
    confirm: z
      .boolean({ error: "must be the boolean true to close the account" })
      .optional()
      .describe("Must be true to apply; omitted/false returns a preview only."),
  },
  async handler(ctx, input) {
    const account = await ctx.repos.accounts.getById(ctx.householdId, input.accountId);
    if (account === null) {
      throw new McpToolError(
        "UNKNOWN_ACCOUNT",
        `No account ${input.accountId} in this household.`,
        "Use list_accounts to see this household's account ids.",
      );
    }

    // The zero-balance rule comes first — it holds for previews too.
    const balance = await replayBalanceMinor(ctx, account.id);
    if (balance.minor !== "0") {
      throw new McpToolError(
        "ACCOUNT_NOT_EMPTY",
        `Account "${account.name}" (${account.id}) has a replay balance of ${balance.minor} ` +
          `${balance.currency ?? account.currency} minor units; only a zero-balance account can be closed.`,
        "Record journals that move the balance to zero (see record_journal), then close the account.",
      );
    }

    if (input.confirm !== true) {
      return {
        content: [
          {
            type: "text",
            text:
              `Preview only — nothing was changed. This would close "${account.name}" ` +
              `(${account.id}, replay balance 0). Re-run with confirm: true to apply.`,
          },
        ],
        structuredContent: {
          preview: true,
          confirmationRequired: true,
          account: accountToWire(account),
          balanceMinor: "0",
        },
      };
    }

    const closed = await ctx.repos.accounts.close(ctx.householdId, account.id);
    if (closed === null) {
      // Vanished between the ownership check and the write — treat as unknown.
      throw new McpToolError("UNKNOWN_ACCOUNT", `No account ${input.accountId} in this household.`);
    }

    return {
      content: [
        {
          type: "text",
          text: `Closed ${closed.type} account "${closed.name}" (${closed.id}) at ${closed.closedAt}.`,
        },
      ],
      structuredContent: { preview: false, account: accountToWire(closed) },
    };
  },
});
