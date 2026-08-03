import {
  assertFacilityUseComplete,
  assertJournalBalanced,
  money,
  qtyFromDecimalString,
  type Account,
  type FacilityUseLine,
  type Journal,
  type Posting,
} from "@stonks/ledger";
import { z } from "zod";
import { McpToolError } from "../errors";
import { defineTool, type McpToolContext } from "../registrar";
import {
  zBigIntString,
  zCurrencyCode,
  zMinorAmount,
  zPositiveBigIntString,
  zQuantity,
  zTradeDate,
  minorFromString,
} from "../schemas";
import { JOURNAL_TYPE_VALUES, journalToWire } from "./journals-read";

/**
 * Task 7 write tools — record_journal and supersede_journal (spec §8 tools
 * 13–14). These are the first tools that mutate financial records, so the
 * safety rules live here deliberately:
 *
 * - Postings only, never a balance; every journal is validated by
 *   `assertJournalBalanced` and `assertFacilityUseComplete` BEFORE anything
 *   is persisted — an unbalanced journal is rejected with the structured
 *   `UNBALANCED_JOURNAL` error and nothing is written.
 * - `sortKey` is assigned server-side via `nextSortKey`; a client-supplied
 *   key is rejected at the schema boundary.
 * - Every account id is verified against the token's household
 *   (`accounts.getById(householdId, id)`) before anything is written; a
 *   foreign id is indistinguishable from an unknown one.
 * - Journals are immutable. `supersede_journal` is the only correction path
 *   and it requires `confirm: true`; without it the tool returns a preview
 *   of what would change and mutates nothing.
 * - Money typing: amounts are minor-unit strings parsed with `BigInt`,
 *   quantities are decimal strings parsed with `qtyFromDecimalString`, FX
 *   rates are bigint-string numerator/denominator pairs. No `z.number()`
 *   anywhere on a money path.
 */

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

const FACILITY_USES = ["INVESTMENT", "LENDING", "PERSONAL", "OTHER"] as const;

const zPostingInput = z.object({
  accountId: z
    .string({ error: "must be an account id string" })
    .min(1, "must be an account id string"),
  amountMinor: zMinorAmount.describe("Signed minor units in the reporting currency."),
  currency: zCurrencyCode
    .optional()
    .describe("Must equal the household reporting currency when present."),
  quantity: zQuantity.optional(),
  securityId: z
    .string({ error: "must be a security id string" })
    .min(1, "must be a security id string")
    .optional(),
  tradeCurrency: zCurrencyCode.optional(),
  tradeAmountMinor: zMinorAmount.optional().describe("Trade-currency amount, minor units."),
  fxRateN: zBigIntString.optional().describe("FX rate numerator (bigint string)."),
  fxRateD: zPositiveBigIntString.optional().describe("FX rate denominator (bigint string)."),
});

const zFacilityUseInput = z.object({
  use: z.enum(FACILITY_USES),
  amountMinor: zMinorAmount,
});

/**
 * The shared journal-write input. `sortKey` uses `z.never().optional()`:
 * absent passes, any supplied value fails with a message naming the field —
 * replay order is (trade_date, sort_key) and a client-supplied key would let
 * a caller silently reorder history.
 */
const journalWriteShape = {
  type: z.enum(JOURNAL_TYPE_VALUES),
  tradeDate: zTradeDate,
  memo: z.string({ error: "must be a string" }).optional(),
  externalNaturalKey: z
    .string({ error: "must be a string" })
    .min(1, "must be a non-empty string")
    .optional()
    .describe("Idempotency key; a repeat submission returns the existing journal id."),
  sortKey: z
    .never({ error: "sortKey is assigned server-side and must not be sent" })
    .optional(),
  postings: z
    .array(zPostingInput)
    .min(2, "must have at least 2 postings (a journal must balance)"),
  facilityUses: z
    .array(zFacilityUseInput)
    .min(1, "must have at least one line when present")
    .optional()
    .describe("Required to cover 100% of any credit-facility draw."),
};

const zJournalWriteInput = z.object(journalWriteShape);
type JournalWriteInput = z.infer<typeof zJournalWriteInput>;

/**
 * Verify accounts, build the domain journal, run the ledger invariants.
 * Shared by both write tools so validation can never drift between recording
 * and correcting. Throws `McpToolError`/`ValidationError`; nothing persists
 * here.
 */
async function buildPostedJournal(
  ctx: McpToolContext,
  input: JournalWriteInput,
): Promise<Journal> {
  // Household scoping before anything else: every referenced account id must
  // resolve inside the token's household.
  const accounts = new Map<string, Account>();
  for (const posting of input.postings) {
    if (accounts.has(posting.accountId)) continue;
    const record = await ctx.repos.accounts.getById(ctx.householdId, posting.accountId);
    if (record === null) {
      throw new McpToolError(
        "UNKNOWN_ACCOUNT",
        `No account ${posting.accountId} in this household.`,
        "Use list_accounts to see this household's account ids.",
      );
    }
    accounts.set(posting.accountId, {
      id: record.id,
      type: record.type,
      currency: record.currency,
    });
  }

  const reportingCurrency = await ctx.repos.household.getReportingCurrency(ctx.householdId);
  if (reportingCurrency === null) {
    // A verified token implies the household exists (same anomaly as ping).
    throw new Error(`Household row missing for authenticated household ${ctx.householdId}`);
  }

  for (const posting of input.postings) {
    if (posting.currency !== undefined && posting.currency !== reportingCurrency) {
      throw new McpToolError(
        "VALIDATION",
        `posting currency "${posting.currency}" is not the household reporting currency ` +
          `"${reportingCurrency}" — amounts are always recorded in the reporting currency; ` +
          "carry the trade leg in tradeCurrency/tradeAmountMinor/fxRateN/fxRateD.",
      );
    }
  }

  // The replacement leg of a supersession may carry a natural key; a key that
  // already exists must fail loudly, not collide at the database.
  if (input.externalNaturalKey !== undefined) {
    const existing = await ctx.repos.journalWrites.findByNaturalKey(
      ctx.householdId,
      input.externalNaturalKey,
    );
    if (existing !== null) {
      throw new McpToolError(
        "DUPLICATE_NATURAL_KEY",
        `externalNaturalKey "${input.externalNaturalKey}" already exists on journal ${existing}.`,
        "Omit the key, or use record_journal which returns the existing id with duplicate: true.",
      );
    }
  }

  const postings: Posting[] = input.postings.map((p) => {
    const posting: Posting = {
      accountId: p.accountId,
      amount: money(reportingCurrency, minorFromString(p.amountMinor)),
    };
    if (p.quantity !== undefined) posting.quantity = qtyFromDecimalString(p.quantity);
    if (p.securityId !== undefined) posting.securityId = p.securityId;
    if (p.tradeCurrency !== undefined) posting.tradeCurrency = p.tradeCurrency;
    if (p.tradeAmountMinor !== undefined) {
      posting.tradeAmountMinor = minorFromString(p.tradeAmountMinor);
    }
    if (p.fxRateN !== undefined) posting.fxRateN = minorFromString(p.fxRateN);
    if (p.fxRateD !== undefined) posting.fxRateD = minorFromString(p.fxRateD);
    return posting;
  });

  const facilityUses: FacilityUseLine[] | undefined = input.facilityUses?.map((line) => ({
    use: line.use,
    amount: money(reportingCurrency, minorFromString(line.amountMinor)),
  }));

  const journal: Journal = {
    id: crypto.randomUUID(),
    type: input.type,
    tradeDate: input.tradeDate,
    sortKey: await ctx.repos.journalWrites.nextSortKey(ctx.householdId, input.tradeDate),
    status: "POSTED",
    source: "MANUAL",
    postings,
  };
  if (input.memo !== undefined) journal.memo = input.memo;
  if (input.externalNaturalKey !== undefined) {
    journal.externalNaturalKey = input.externalNaturalKey;
  }
  if (facilityUses !== undefined) journal.facilityUses = facilityUses;

  // The domain gate: an unbalanced journal or an incomplete facility use is
  // rejected here, before any persistence — never a partial write.
  assertJournalBalanced(journal);
  assertFacilityUseComplete(journal, accounts);

  return journal;
}

export const recordJournalTool = defineTool({
  name: "record_journal",
  description:
    "Record a journal of any type (BUY, SELL, DIVIDEND, INTEREST_CHARGED, INTEREST_EARNED, " +
    "FEE, TRANSFER, DEPOSIT, WITHDRAWAL, CORPORATE_ACTION, OPENING) from balanced postings — " +
    "never a balance; balances are derived by replay. Amounts are minor-unit strings in the " +
    "household reporting currency; quantities are decimal strings; FX is a rational " +
    "fxRateN/fxRateD pair. Postings must sum to zero and any credit-facility draw must be " +
    "fully covered by facilityUses. sortKey is assigned server-side. When externalNaturalKey " +
    "already exists, the existing journal id is returned with duplicate: true instead of " +
    "double-posting. Opening positions with unknown cost are legal — omit the cost fields.",
  scope: "read_write",
  annotations: ADDITIVE,
  inputSchema: journalWriteShape,
  async handler(ctx, input) {
    if (input.externalNaturalKey !== undefined) {
      const existing = await ctx.repos.journalWrites.findByNaturalKey(
        ctx.householdId,
        input.externalNaturalKey,
      );
      if (existing !== null) {
        return {
          content: [
            {
              type: "text",
              text:
                `externalNaturalKey "${input.externalNaturalKey}" was already recorded as ` +
                `journal ${existing}; returning it instead of double-posting.`,
            },
          ],
          structuredContent: { duplicate: true, journalId: existing },
        };
      }
    }

    const journal = await buildPostedJournal(ctx, input);
    await ctx.repos.journalWrites.insertPosted(journal, ctx.householdId);

    return {
      content: [
        {
          type: "text",
          text:
            `Recorded ${journal.type} journal ${journal.id} dated ${journal.tradeDate} ` +
            `(${journal.postings.length} postings, balanced).`,
        },
      ],
      structuredContent: {
        duplicate: false,
        journalId: journal.id,
        journal: journalToWire(journal),
      },
    };
  },
});

export const supersedeJournalTool = defineTool({
  name: "supersede_journal",
  description:
    "Correct a POSTED journal: marks it SUPERSEDED and posts the replacement with " +
    "supersedesJournalId, atomically — history is retained and the original stays readable. " +
    "The replacement is validated exactly like record_journal (balanced postings, household " +
    "accounts, server-assigned sortKey). HARD TO REVERSE: without confirm: true the tool " +
    "returns a preview of the change and mutates nothing.",
  scope: "read_write",
  annotations: HARD_TO_REVERSE,
  inputSchema: {
    journalId: z
      .string({ error: "must be a journal id string" })
      .min(1, "must be a journal id string"),
    replacement: zJournalWriteInput.describe("The corrected journal (same shape as record_journal)."),
    confirm: z
      .boolean({ error: "must be the boolean true to apply the supersession" })
      .optional()
      .describe("Must be true to apply; omitted/false returns a preview only."),
  },
  async handler(ctx, input) {
    const old = await ctx.repos.journals.getById(ctx.householdId, input.journalId);
    if (old === null) {
      throw new McpToolError(
        "UNKNOWN_JOURNAL",
        `No journal ${input.journalId} in this household.`,
        "Use list_journals to browse this household's journal history.",
      );
    }
    if (old.status !== "POSTED") {
      throw new McpToolError(
        "NOT_POSTED",
        `Journal ${old.id} is ${old.status}; only a POSTED journal can be superseded.`,
        "Supersede the journal that superseded it instead, to keep the correction chain linear.",
      );
    }

    // The replacement is fully validated before the confirm gate: a preview
    // of an invalid correction would be worse than no preview.
    const replacement = await buildPostedJournal(ctx, input.replacement);

    if (input.confirm !== true) {
      return {
        content: [
          {
            type: "text",
            text:
              `Preview only — nothing was changed. This would mark ${old.type} journal ` +
              `${old.id} (${old.tradeDate}) SUPERSEDED and post the replacement in its place. ` +
              "Re-run with confirm: true to apply.",
          },
        ],
        structuredContent: {
          preview: true,
          confirmationRequired: true,
          journalId: old.id,
          current: journalToWire(old),
          replacement: journalToWire(replacement),
        },
      };
    }

    await ctx.repos.journalWrites.supersedePosted(ctx.householdId, old.id, replacement);

    return {
      content: [
        {
          type: "text",
          text:
            `Superseded ${old.type} journal ${old.id} with ${replacement.id} ` +
            `(${replacement.tradeDate}). The original is retained as SUPERSEDED history.`,
        },
      ],
      structuredContent: {
        preview: false,
        supersededJournalId: old.id,
        replacementJournalId: replacement.id,
        replacement: journalToWire({ ...replacement, supersedesJournalId: old.id }),
      },
    };
  },
});
