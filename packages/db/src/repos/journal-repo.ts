import { and, asc, eq, gt, gte, inArray, lte, max, or } from "drizzle-orm";
import type { Journal, JournalType, Posting } from "@stonks/ledger";
import { ValidationError, money, qtyFromDecimalString, qtyToDecimalString } from "@stonks/ledger";
import type { Db } from "../client.js";
import {
  household,
  journal,
  journalFacilityUse,
  posting,
} from "../schema/index.js";

/**
 * A position in the replay order (trade_date, sort_key, id). `listAll`
 * returns rows strictly after the cursor. The wire form is an opaque string
 * produced by `encodeJournalCursor`; the repo takes the decoded position so
 * malformed cursors are rejected by callers, never silently ignored.
 */
export interface JournalCursor {
  tradeDate: string;
  sortKey: number;
  id: string;
}

export function encodeJournalCursor(position: JournalCursor): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

export function decodeJournalCursor(cursor: string): JournalCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.tradeDate !== "string" ||
      typeof p.sortKey !== "number" ||
      !Number.isInteger(p.sortKey) ||
      typeof p.id !== "string"
    ) {
      return null;
    }
    return { tradeDate: p.tradeDate, sortKey: p.sortKey, id: p.id };
  } catch {
    return null;
  }
}

export interface JournalListFilters {
  type?: JournalType;
  /** Journals with at least one posting in this account. */
  accountId?: string;
  /** Inclusive trade_date bounds (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** SUPERSEDED rows are returned only when explicitly asked for. */
  includeSuperseded?: boolean;
  limit?: number;
  /** Rows strictly after this position in (trade_date, sort_key, id) order. */
  cursor?: JournalCursor;
}

export interface JournalRepo {
  insertPosted(journal: Journal, householdId: string): Promise<void>;
  /** Posted journals only — the input set for replay and the read model. */
  listPosted(householdId: string): Promise<Journal[]>;
  /**
   * Journal history for the household, ordered by (trade_date, sort_key, id).
   * Superseded rows appear only when `includeSuperseded` is set — corrections
   * use supersession rather than mutation, and the audit history needs the
   * superseded row plus its `supersedesJournalId` link. Replay must keep
   * calling `listPosted` — this method must never feed `replay()`.
   */
  listAll(householdId: string, filters?: JournalListFilters): Promise<Journal[]>;
  /** Single fetch, household-scoped: a foreign id returns null. */
  getById(householdId: string, id: string): Promise<Journal | null>;
  /** Idempotency lookup for `externalNaturalKey`, household-scoped. */
  findByNaturalKey(householdId: string, key: string): Promise<string | null>;
  /** The journal that superseded this one, if any (the forward chain link). */
  findSupersedingId(householdId: string, journalId: string): Promise<string | null>;
  /** Next free POSTED sort_key for (household, trade_date) — server-assigned only. */
  nextSortKey(householdId: string, tradeDate: string): Promise<number>;
  /**
   * One transaction: the old row must be POSTED (else `ValidationError`),
   * it becomes SUPERSEDED, and the replacement is inserted POSTED with
   * `supersedesJournalId` forced to the old id. A failure anywhere rolls the
   * whole correction back — history is never left half-written.
   */
  supersedePosted(householdId: string, oldId: string, replacement: Journal): Promise<void>;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createJournalRepo(db: Db): JournalRepo {
  return {
    async insertPosted(j, householdId) {
      assertPostable(j);
      await db.transaction((tx) => insertPostedTx(tx, j, householdId));
    },

    async listPosted(householdId) {
      const journalRows = await db
        .select()
        .from(journal)
        .where(and(eq(journal.householdId, householdId), eq(journal.status, "POSTED")));
      return hydrateJournals(db, journalRows);
    },

    async listAll(householdId, filters) {
      const conditions = [eq(journal.householdId, householdId)];

      if (!filters?.includeSuperseded) {
        conditions.push(eq(journal.status, "POSTED"));
      }
      if (filters?.type) {
        conditions.push(eq(journal.type, filters.type));
      }
      if (filters?.from) {
        conditions.push(gte(journal.tradeDate, filters.from));
      }
      if (filters?.to) {
        conditions.push(lte(journal.tradeDate, filters.to));
      }
      if (filters?.accountId) {
        conditions.push(
          inArray(
            journal.id,
            db
              .selectDistinct({ journalId: posting.journalId })
              .from(posting)
              .where(eq(posting.accountId, filters.accountId)),
          ),
        );
      }
      if (filters?.cursor) {
        const c = filters.cursor;
        const after = or(
          gt(journal.tradeDate, c.tradeDate),
          and(eq(journal.tradeDate, c.tradeDate), gt(journal.sortKey, c.sortKey)),
          and(
            eq(journal.tradeDate, c.tradeDate),
            eq(journal.sortKey, c.sortKey),
            gt(journal.id, c.id),
          ),
        );
        if (after) conditions.push(after);
      }

      let query = db
        .select()
        .from(journal)
        .where(and(...conditions))
        .orderBy(asc(journal.tradeDate), asc(journal.sortKey), asc(journal.id))
        .$dynamic();
      if (filters?.limit !== undefined) {
        query = query.limit(filters.limit);
      }

      return hydrateJournals(db, await query);
    },

    async getById(householdId, id) {
      const rows = await db
        .select()
        .from(journal)
        .where(and(eq(journal.householdId, householdId), eq(journal.id, id)))
        .limit(1);
      if (rows.length === 0) return null;
      const [hydrated] = await hydrateJournals(db, rows);
      return hydrated ?? null;
    },

    async findByNaturalKey(householdId, key) {
      const [row] = await db
        .select({ id: journal.id })
        .from(journal)
        .where(
          and(
            eq(journal.householdId, householdId),
            eq(journal.externalNaturalKey, key),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async findSupersedingId(householdId, journalId) {
      const [row] = await db
        .select({ id: journal.id })
        .from(journal)
        .where(
          and(
            eq(journal.householdId, householdId),
            eq(journal.supersedesJournalId, journalId),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async nextSortKey(householdId, tradeDate) {
      const [row] = await db
        .select({ maxKey: max(journal.sortKey) })
        .from(journal)
        .where(
          and(
            eq(journal.householdId, householdId),
            eq(journal.tradeDate, tradeDate),
            eq(journal.status, "POSTED"),
          ),
        );
      return (row?.maxKey ?? -1) + 1;
    },

    async supersedePosted(householdId, oldId, replacement) {
      assertPostable(replacement);
      await db.transaction(async (tx) => {
        const [old] = await tx
          .select({ status: journal.status })
          .from(journal)
          .where(and(eq(journal.id, oldId), eq(journal.householdId, householdId)))
          .limit(1);

        if (!old) {
          throw new ValidationError(
            `Unknown journal in this household: ${oldId}`,
            "UNKNOWN_JOURNAL",
            [oldId],
          );
        }
        if (old.status !== "POSTED") {
          throw new ValidationError(
            `Journal ${oldId} is ${old.status}; only a POSTED journal can be superseded`,
            "NOT_POSTED",
            [oldId],
          );
        }

        await tx
          .update(journal)
          .set({ status: "SUPERSEDED" })
          .where(and(eq(journal.id, oldId), eq(journal.status, "POSTED")));

        // The repo owns the chain link — a caller cannot point the
        // replacement at a different predecessor.
        await insertPostedTx(tx, { ...replacement, supersedesJournalId: oldId }, householdId);
      });
    },
  };
}

function assertPostable(j: Journal): void {
  if (j.status !== "POSTED") {
    throw new Error("insertPosted requires POSTED status");
  }
}

async function insertPostedTx(tx: Tx, j: Journal, householdId: string): Promise<void> {
  await tx.insert(journal).values({
    id: j.id,
    householdId,
    type: j.type,
    tradeDate: j.tradeDate,
    sortKey: j.sortKey,
    memo: j.memo ?? null,
    externalNaturalKey: j.externalNaturalKey ?? null,
    source: j.source,
    status: j.status,
    supersedesJournalId: j.supersedesJournalId ?? null,
  });

  if (j.postings.length > 0) {
    await tx.insert(posting).values(
      j.postings.map((p) => ({
        journalId: j.id,
        accountId: p.accountId,
        amountMinor: p.amount.minor,
        quantity: p.quantity ? qtyToDecimalString(p.quantity) : null,
        securityId: p.securityId ?? null,
        tradeCurrency: p.tradeCurrency ?? null,
        reportingAmountMinor: p.tradeAmountMinor ?? null,
        fxRateN: p.fxRateN ?? null,
        fxRateD: p.fxRateD ?? null,
      })),
    );
  }

  if (j.facilityUses && j.facilityUses.length > 0) {
    await tx.insert(journalFacilityUse).values(
      j.facilityUses.map((fu) => ({
        journalId: j.id,
        use: fu.use,
        amountMinor: fu.amount.minor,
      })),
    );
  }
}

async function hydrateJournals(
  db: Db,
  journalRows: Array<typeof journal.$inferSelect>,
): Promise<Journal[]> {
  if (journalRows.length === 0) {
    return [];
  }

  const householdIds = [...new Set(journalRows.map((row) => row.householdId))];
  const householdRows = await db
    .select({ id: household.id, reportingCurrency: household.reportingCurrency })
    .from(household)
    .where(inArray(household.id, householdIds));

  const currencyByHousehold = new Map(householdRows.map((row) => [row.id, row.reportingCurrency]));
  for (const id of householdIds) {
    if (!currencyByHousehold.has(id)) {
      throw new Error(`Household not found: ${id}`);
    }
  }

  const journalIds = journalRows.map((row) => row.id);

  const postingRows = await db
    .select()
    .from(posting)
    .where(inArray(posting.journalId, journalIds));

  const facilityRows = await db
    .select()
    .from(journalFacilityUse)
    .where(inArray(journalFacilityUse.journalId, journalIds));

  const postingsByJournal = new Map<string, Array<typeof posting.$inferSelect>>();
  for (const row of postingRows) {
    const list = postingsByJournal.get(row.journalId) ?? [];
    list.push(row);
    postingsByJournal.set(row.journalId, list);
  }

  const facilityByJournal = new Map<string, Array<typeof journalFacilityUse.$inferSelect>>();
  for (const row of facilityRows) {
    const list = facilityByJournal.get(row.journalId) ?? [];
    list.push(row);
    facilityByJournal.set(row.journalId, list);
  }

  return journalRows.map((row) =>
    toDomainJournal(
      row,
      postingsByJournal.get(row.id) ?? [],
      facilityByJournal.get(row.id) ?? [],
      currencyByHousehold.get(row.householdId)!,
    ),
  );
}

function toDomainJournal(
  row: typeof journal.$inferSelect,
  postingRows: Array<typeof posting.$inferSelect>,
  facilityRows: Array<typeof journalFacilityUse.$inferSelect>,
  reportingCurrency: string,
): Journal {
  const domainPostings: Posting[] = postingRows.map((p) => {
    const domainPosting: Posting = {
      accountId: p.accountId,
      amount: money(reportingCurrency, p.amountMinor),
    };

    if (p.quantity !== null) {
      domainPosting.quantity = qtyFromDecimalString(String(p.quantity));
    }
    if (p.securityId) {
      domainPosting.securityId = p.securityId;
    }
    if (p.tradeCurrency) {
      domainPosting.tradeCurrency = p.tradeCurrency;
    }
    if (p.reportingAmountMinor !== null) {
      domainPosting.tradeAmountMinor = p.reportingAmountMinor;
    }
    if (p.fxRateN !== null) {
      domainPosting.fxRateN = p.fxRateN;
    }
    if (p.fxRateD !== null) {
      domainPosting.fxRateD = p.fxRateD;
    }

    return domainPosting;
  });

  const domainJournal: Journal = {
    id: row.id,
    type: row.type,
    tradeDate: row.tradeDate,
    sortKey: row.sortKey,
    status: row.status,
    source: row.source,
    postings: domainPostings,
  };

  if (row.memo) {
    domainJournal.memo = row.memo;
  }
  if (row.externalNaturalKey) {
    domainJournal.externalNaturalKey = row.externalNaturalKey;
  }
  if (row.supersedesJournalId) {
    domainJournal.supersedesJournalId = row.supersedesJournalId;
  }
  if (facilityRows.length > 0) {
    domainJournal.facilityUses = facilityRows.map((fu) => ({
      use: fu.use,
      amount: money(reportingCurrency, fu.amountMinor),
    }));
  }

  return domainJournal;
}
