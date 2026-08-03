import { decodeJournalCursor, encodeJournalCursor, type JournalCursor } from "@stonks/db";
import { qtyToDecimalString, type Journal } from "@stonks/ledger";
import { z } from "zod";
import { McpToolError } from "../errors";
import { defineTool, type McpToolContext } from "../registrar";
import { zTradeDate } from "../schemas";

/**
 * Task 6 read tools — journal history (spec §8 tools 4–5).
 *
 * Both tools delegate to the journal repository (`listAll` / `getById` /
 * `findSupersedingId`) with the household id from the token context; nothing
 * is computed here beyond wire projection. Journals are immutable and
 * corrections use supersession, so SUPERSEDED rows are never hidden — they
 * are excluded from `list_journals` only by default, and always marked with
 * their status and `supersedesJournalId` when included.
 */

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const JOURNAL_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST_CHARGED",
  "INTEREST_EARNED",
  "FEE",
  "TRANSFER",
  "DEPOSIT",
  "WITHDRAWAL",
  "CORPORATE_ACTION",
  "OPENING",
] as const;

/** The journal type list, shared with the write tools' input schema. */
export const JOURNAL_TYPE_VALUES = JOURNAL_TYPES;

const DEFAULT_LIMIT = 50;

/** Domain journal → wire JSON. Every money/quantity/FX field is a string. */
export function journalToWire(journal: Journal) {
  return {
    id: journal.id,
    type: journal.type,
    tradeDate: journal.tradeDate,
    sortKey: journal.sortKey,
    status: journal.status,
    source: journal.source,
    memo: journal.memo ?? null,
    externalNaturalKey: journal.externalNaturalKey ?? null,
    supersedesJournalId: journal.supersedesJournalId ?? null,
    postings: journal.postings.map((posting) => ({
      accountId: posting.accountId,
      amountMinor: posting.amount.minor.toString(),
      currency: posting.amount.currency,
      quantity: posting.quantity === undefined ? null : qtyToDecimalString(posting.quantity),
      securityId: posting.securityId ?? null,
      tradeCurrency: posting.tradeCurrency ?? null,
      tradeAmountMinor:
        posting.tradeAmountMinor === undefined ? null : posting.tradeAmountMinor.toString(),
      fxRateN: posting.fxRateN === undefined ? null : posting.fxRateN.toString(),
      fxRateD: posting.fxRateD === undefined ? null : posting.fxRateD.toString(),
    })),
    facilityUses: (journal.facilityUses ?? []).map((line) => ({
      use: line.use,
      amountMinor: line.amount.minor.toString(),
      currency: line.amount.currency,
    })),
  };
}

/** A caller-supplied account id must resolve inside the token's household. */
async function assertOwnAccount(ctx: McpToolContext, accountId: string): Promise<void> {
  const account = await ctx.repos.accounts.getById(ctx.householdId, accountId);
  if (account === null) {
    throw new McpToolError(
      "UNKNOWN_ACCOUNT",
      `No account ${accountId} in this household.`,
      "Use list_accounts to see this household's account ids.",
    );
  }
}

function decodeCursorOrThrow(raw: string): JournalCursor {
  const decoded = decodeJournalCursor(raw);
  if (decoded === null) {
    throw new McpToolError(
      "INVALID_INPUT",
      "cursor is malformed — pass the nextCursor value returned by a previous list_journals call unchanged.",
    );
  }
  return decoded;
}

export const listJournalsTool = defineTool({
  name: "list_journals",
  description:
    "Journal history with postings, filterable by type, account, and inclusive trade-date " +
    "range, ordered by (tradeDate, sortKey, id). Superseded journals are excluded unless " +
    "includeSuperseded is set; they are always marked with their status and " +
    "supersedesJournalId. Paginate with limit and the returned nextCursor.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    type: z.enum(JOURNAL_TYPES).optional().describe("Only journals of this type."),
    accountId: z
      .string({ error: "must be an account id string" })
      .min(1, "must be an account id string")
      .optional()
      .describe("Only journals with at least one posting in this account."),
    from: zTradeDate.optional().describe("Inclusive trade-date lower bound (YYYY-MM-DD)."),
    to: zTradeDate.optional().describe("Inclusive trade-date upper bound (YYYY-MM-DD)."),
    includeSuperseded: z
      .boolean()
      .optional()
      .describe("Include SUPERSEDED journals (the audit trail of corrections). Default false."),
    limit: z
      .number({ error: "must be an integer page size" })
      .int("must be an integer page size")
      .min(1, "must be at least 1")
      .max(200, "must be at most 200")
      .optional()
      .describe(`Page size (default ${DEFAULT_LIMIT}, max 200).`),
    cursor: z
      .string({ error: "must be the opaque nextCursor string from a previous call" })
      .optional()
      .describe("Opaque cursor from a previous call's nextCursor."),
  },
  async handler(ctx, input) {
    if (input.accountId !== undefined) {
      await assertOwnAccount(ctx, input.accountId);
    }
    const cursor = input.cursor === undefined ? undefined : decodeCursorOrThrow(input.cursor);

    const limit = input.limit ?? DEFAULT_LIMIT;
    // One extra row tells us whether another page exists without a count query.
    const rows = await ctx.repos.journals.listAll(ctx.householdId, {
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      includeSuperseded: input.includeSuperseded ?? false,
      limit: limit + 1,
      ...(cursor === undefined ? {} : { cursor }),
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeJournalCursor({ tradeDate: last.tradeDate, sortKey: last.sortKey, id: last.id })
        : null;

    return {
      content: [
        {
          type: "text",
          text:
            `${page.length} journal(s)` +
            (nextCursor === null ? "" : "; more available — pass nextCursor to continue") +
            ".",
        },
      ],
      structuredContent: {
        journals: page.map(journalToWire),
        nextCursor,
      },
    };
  },
});

export const getJournalTool = defineTool({
  name: "get_journal",
  description:
    "One journal by id, with its postings (minor-string amounts, decimal quantities, " +
    "rational FX), facility uses, and its supersession chain: the journal it supersedes " +
    "and the one that superseded it. An id outside this household is UNKNOWN_JOURNAL.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: {
    journalId: z
      .string({ error: "must be a journal id string" })
      .min(1, "must be a journal id string"),
  },
  async handler(ctx, input) {
    const journal = await ctx.repos.journals.getById(ctx.householdId, input.journalId);
    if (journal === null) {
      throw new McpToolError(
        "UNKNOWN_JOURNAL",
        `No journal ${input.journalId} in this household.`,
        "Use list_journals to browse this household's journal history.",
      );
    }

    const supersededByJournalId = await ctx.repos.journals.findSupersedingId(
      ctx.householdId,
      journal.id,
    );

    return {
      content: [
        {
          type: "text",
          text:
            `${journal.type} journal ${journal.id} dated ${journal.tradeDate} ` +
            `(${journal.status}), ${journal.postings.length} posting(s).`,
        },
      ],
      structuredContent: {
        journal: journalToWire(journal),
        supersession: {
          supersedesJournalId: journal.supersedesJournalId ?? null,
          supersededByJournalId,
        },
      },
    };
  },
});
