/**
 * Journal creation — pure request validation + domain assembly.
 *
 * The HTTP route authenticates and loads household accounts, then hands off
 * here. Money arrives as **minor-unit strings** and is parsed with `BigInt`
 * only. `sortKey` is assigned by the caller-supplied `nextSortKeyForDate`
 * — never accepted from the client. Nothing is written until
 * `assertJournalBalanced` (and, when applicable, `assertFacilityUseComplete`)
 * pass.
 */

import {
  ValidationError,
  assertFacilityUseComplete,
  assertJournalBalanced,
  money,
  qtyFromDecimalString,
  type Account,
  type FacilityUse,
  type FacilityUseLine,
  type Journal,
  type JournalType,
  type Posting,
} from "@stonks/ledger";
import { decimalStringToMinor } from "@/lib/market/decimal";

const JOURNAL_TYPES = new Set<JournalType>([
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
]);

const FACILITY_USES = new Set<FacilityUse>([
  "INVESTMENT",
  "LENDING",
  "PERSONAL",
  "OTHER",
]);

const TRADE_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Signed integer string — the wire form of a money amount in minor units. */
const MINOR_INTEGER = /^-?\d+$/;

export type CreateJournalResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

export type CreateJournalContext = {
  householdId: string;
  /** Accounts that belong to this household. Foreign ids are rejected. */
  accounts: ReadonlyMap<string, Account>;
  reportingCurrency: string;
  nextSortKeyForDate: (tradeDate: string) => Promise<number>;
  insertPosted: (journal: Journal, householdId: string) => Promise<void>;
  newId: () => string;
};

/**
 * Validate an untrusted POST body, build a domain `Journal`, run the ledger
 * invariants, and persist. Returns a structured result — never throws for
 * caller/input errors.
 */
export async function createPostedJournal(
  body: unknown,
  ctx: CreateJournalContext,
): Promise<CreateJournalResult> {
  const parsed = parseCreateJournalBody(body);
  if (!parsed.ok) return parsed;

  for (const posting of parsed.value.postings) {
    if (!ctx.accounts.has(posting.accountId)) {
      return {
        ok: false,
        status: 400,
        error: `Unknown account not in this household: ${posting.accountId}`,
      };
    }
  }

  if (parsed.value.facilityUses) {
    // Facility uses carry no account id, but the draw account still must be
    // in-household — already checked via postings above.
  }

  let postings: Posting[];
  let facilityUses: FacilityUseLine[] | undefined;
  try {
    postings = parsed.value.postings.map((p) =>
      toDomainPosting(p, ctx.reportingCurrency),
    );
    if (parsed.value.facilityUses) {
      facilityUses = parsed.value.facilityUses.map((line) => ({
        use: line.use,
        amount: money(ctx.reportingCurrency, BigInt(line.amountMinor)),
      }));
    }
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : "Invalid posting",
    };
  }

  const sortKey = await ctx.nextSortKeyForDate(parsed.value.tradeDate);
  const id = ctx.newId();

  const journal: Journal = {
    id,
    type: parsed.value.type,
    tradeDate: parsed.value.tradeDate,
    sortKey,
    status: "POSTED",
    source: "MANUAL",
    postings,
  };
  if (parsed.value.memo !== undefined) {
    journal.memo = parsed.value.memo;
  }
  if (facilityUses !== undefined) {
    journal.facilityUses = facilityUses;
  }

  try {
    assertJournalBalanced(journal);
    assertFacilityUseComplete(journal, ctx.accounts);
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, status: 400, error: error.message };
    }
    throw error;
  }

  await ctx.insertPosted(journal, ctx.householdId);
  return { ok: true, id };
}

type ParsedPosting = {
  accountId: string;
  amountMinor: string;
  quantity?: string;
  securityId?: string;
  tradeCurrency?: string;
  tradeAmountMinor?: string;
  fxRateN?: string;
  fxRateD?: string;
};

type ParsedFacilityUse = {
  use: FacilityUse;
  amountMinor: string;
};

type ParsedCreateBody = {
  type: JournalType;
  tradeDate: string;
  memo?: string;
  postings: ParsedPosting[];
  facilityUses?: ParsedFacilityUse[];
};

function parseCreateJournalBody(
  body: unknown,
): CreateJournalResult & { ok: false } | { ok: true; value: ParsedCreateBody } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;

  if ("sortKey" in record) {
    return {
      ok: false,
      status: 400,
      error: "sortKey is assigned server-side and must not be sent",
    };
  }

  if (typeof record.type !== "string" || !JOURNAL_TYPES.has(record.type as JournalType)) {
    return { ok: false, status: 400, error: "Invalid or missing journal type" };
  }

  if (typeof record.tradeDate !== "string" || !TRADE_DATE.test(record.tradeDate)) {
    return {
      ok: false,
      status: 400,
      error: "tradeDate must be an ISO date string (YYYY-MM-DD)",
    };
  }

  let memo: string | undefined;
  if (record.memo !== undefined && record.memo !== null) {
    if (typeof record.memo !== "string") {
      return { ok: false, status: 400, error: "memo must be a string" };
    }
    memo = record.memo;
  }

  if (!Array.isArray(record.postings) || record.postings.length < 2) {
    return {
      ok: false,
      status: 400,
      error: "postings must be an array with at least 2 entries",
    };
  }

  const postings: ParsedPosting[] = [];
  for (let i = 0; i < record.postings.length; i++) {
    const parsed = parsePostingInput(record.postings[i], i);
    if (!parsed.ok) return parsed;
    postings.push(parsed.value);
  }

  let facilityUses: ParsedFacilityUse[] | undefined;
  if (record.facilityUses !== undefined) {
    if (!Array.isArray(record.facilityUses)) {
      return { ok: false, status: 400, error: "facilityUses must be an array" };
    }
    facilityUses = [];
    for (let i = 0; i < record.facilityUses.length; i++) {
      const parsed = parseFacilityUseInput(record.facilityUses[i], i);
      if (!parsed.ok) return parsed;
      facilityUses.push(parsed.value);
    }
  }

  const value: ParsedCreateBody = {
    type: record.type as JournalType,
    tradeDate: record.tradeDate,
    postings,
  };
  if (memo !== undefined) value.memo = memo;
  if (facilityUses !== undefined) value.facilityUses = facilityUses;
  return { ok: true, value };
}

function parsePostingInput(
  raw: unknown,
  index: number,
): CreateJournalResult & { ok: false } | { ok: true; value: ParsedPosting } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: `postings[${index}] must be an object`,
    };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.accountId !== "string" || p.accountId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `postings[${index}].accountId must be a non-empty string`,
    };
  }

  if (typeof p.amountMinor !== "string") {
    return {
      ok: false,
      status: 400,
      error: `postings[${index}].amountMinor must be a minor-unit string`,
    };
  }
  if (!MINOR_INTEGER.test(p.amountMinor)) {
    return {
      ok: false,
      status: 400,
      error: `postings[${index}].amountMinor must be a signed integer string`,
    };
  }

  const value: ParsedPosting = {
    accountId: p.accountId,
    amountMinor: p.amountMinor,
  };

  if (p.quantity !== undefined) {
    if (typeof p.quantity !== "string") {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].quantity must be a string`,
      };
    }
    value.quantity = p.quantity;
  }
  if (p.securityId !== undefined) {
    if (typeof p.securityId !== "string") {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].securityId must be a string`,
      };
    }
    value.securityId = p.securityId;
  }
  if (p.tradeCurrency !== undefined) {
    if (typeof p.tradeCurrency !== "string") {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].tradeCurrency must be a string`,
      };
    }
    value.tradeCurrency = p.tradeCurrency;
  }
  if (p.tradeAmountMinor !== undefined) {
    if (typeof p.tradeAmountMinor !== "string" || !MINOR_INTEGER.test(p.tradeAmountMinor)) {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].tradeAmountMinor must be a minor-unit string`,
      };
    }
    value.tradeAmountMinor = p.tradeAmountMinor;
  }
  if (p.fxRateN !== undefined) {
    if (typeof p.fxRateN !== "string" || !MINOR_INTEGER.test(p.fxRateN)) {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].fxRateN must be an integer string`,
      };
    }
    value.fxRateN = p.fxRateN;
  }
  if (p.fxRateD !== undefined) {
    if (typeof p.fxRateD !== "string" || !MINOR_INTEGER.test(p.fxRateD)) {
      return {
        ok: false,
        status: 400,
        error: `postings[${index}].fxRateD must be an integer string`,
      };
    }
    value.fxRateD = p.fxRateD;
  }

  return { ok: true, value };
}

function parseFacilityUseInput(
  raw: unknown,
  index: number,
): CreateJournalResult & { ok: false } | { ok: true; value: ParsedFacilityUse } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: `facilityUses[${index}] must be an object`,
    };
  }
  const line = raw as Record<string, unknown>;

  if (typeof line.use !== "string" || !FACILITY_USES.has(line.use as FacilityUse)) {
    return {
      ok: false,
      status: 400,
      error: `facilityUses[${index}].use is invalid`,
    };
  }
  if (typeof line.amountMinor !== "string") {
    return {
      ok: false,
      status: 400,
      error: `facilityUses[${index}].amountMinor must be a minor-unit string`,
    };
  }
  if (!MINOR_INTEGER.test(line.amountMinor)) {
    return {
      ok: false,
      status: 400,
      error: `facilityUses[${index}].amountMinor must be a signed integer string`,
    };
  }

  return {
    ok: true,
    value: { use: line.use as FacilityUse, amountMinor: line.amountMinor },
  };
}

function toDomainPosting(
  p: ParsedPosting,
  reportingCurrency: string,
): Posting {
  const posting: Posting = {
    accountId: p.accountId,
    amount: money(reportingCurrency, BigInt(p.amountMinor)),
  };
  if (p.quantity !== undefined) {
    posting.quantity = qtyFromDecimalString(p.quantity);
  }
  if (p.securityId !== undefined) {
    posting.securityId = p.securityId;
  }
  if (p.tradeCurrency !== undefined) {
    posting.tradeCurrency = p.tradeCurrency;
  }
  if (p.tradeAmountMinor !== undefined) {
    posting.tradeAmountMinor = BigInt(p.tradeAmountMinor);
  }
  if (p.fxRateN !== undefined) {
    posting.fxRateN = BigInt(p.fxRateN);
  }
  if (p.fxRateD !== undefined) {
    posting.fxRateD = BigInt(p.fxRateD);
  }
  return posting;
}

/**
 * User-typed decimal amount → minor-unit string for the API wire format.
 * Reuses the market decimal converter (string + BigInt, half away from zero).
 */
export function decimalAmountToMinorString(
  value: string,
  minorUnits: number,
): string | null {
  const minor = decimalStringToMinor(value, minorUnits);
  if (minor === null) return null;
  return minor.toString();
}

/** Local calendar date as `YYYY-MM-DD` — what `<input type="date">` expects. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Most recently used non-EXTERNAL account among POSTED journals, ordered by
 * `tradeDate` then `sortKey` then `id` (same as replay). Returns null when
 * none of the selectable accounts have been touched yet.
 */
export function mostRecentlyUsedAccountId(
  journals: readonly Journal[],
  selectableIds: ReadonlySet<string>,
): string | null {
  const posted = journals
    .filter((j) => j.status === "POSTED")
    .slice()
    .sort((a, b) => {
      if (a.tradeDate !== b.tradeDate) {
        return a.tradeDate < b.tradeDate ? -1 : 1;
      }
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  for (let i = posted.length - 1; i >= 0; i--) {
    const journal = posted[i]!;
    for (let p = journal.postings.length - 1; p >= 0; p--) {
      const accountId = journal.postings[p]!.accountId;
      if (selectableIds.has(accountId)) {
        return accountId;
      }
    }
  }
  return null;
}
