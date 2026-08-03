import { and, eq, inArray } from "drizzle-orm";
import type { Journal, Posting } from "@stonks/ledger";
import { money, qtyFromDecimalString, qtyToDecimalString } from "@stonks/ledger";
import type { Db } from "../client.js";
import {
  household,
  journal,
  journalFacilityUse,
  posting,
} from "../schema/index.js";

export interface JournalRepo {
  insertPosted(journal: Journal, householdId: string): Promise<void>;
  /** Posted journals only — the input set for replay and the read model. */
  listPosted(householdId: string): Promise<Journal[]>;
  /**
   * Every journal for the household, including `SUPERSEDED`.
   *
   * Corrections use supersession rather than mutation; the audit history
   * (and the UI that shows it) needs the superseded row plus its
   * `supersedesJournalId` link. Replay must keep calling `listPosted` —
   * this method must never feed `replay()`.
   */
  listAll(householdId: string): Promise<Journal[]>;
}

export function createJournalRepo(db: Db): JournalRepo {
  return {
    async insertPosted(j, householdId) {
      if (j.status !== "POSTED") {
        throw new Error("insertPosted requires POSTED status");
      }

      await db.transaction(async (tx) => {
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
      });
    },

    async listPosted(householdId) {
      return listJournals(db, householdId, "POSTED");
    },

    async listAll(householdId) {
      return listJournals(db, householdId, "ALL");
    },
  };
}

async function listJournals(
  db: Db,
  householdId: string,
  scope: "POSTED" | "ALL",
): Promise<Journal[]> {
  const journalRows = await db
    .select()
    .from(journal)
    .where(
      scope === "POSTED"
        ? and(eq(journal.householdId, householdId), eq(journal.status, "POSTED"))
        : eq(journal.householdId, householdId),
    );

  if (journalRows.length === 0) {
    return [];
  }

  const [householdRow] = await db
    .select({ reportingCurrency: household.reportingCurrency })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1);

  if (!householdRow) {
    throw new Error(`Household not found: ${householdId}`);
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
      householdRow.reportingCurrency,
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
