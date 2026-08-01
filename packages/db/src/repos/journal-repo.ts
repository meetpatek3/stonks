import { and, eq, inArray } from "drizzle-orm";
import type { Journal, Posting } from "@stonks/ledger";
import { money, qtyFromDecimalString, qtyToDecimalString } from "@stonks/ledger";
import type { Db } from "../client.js";
import {
  account,
  household,
  journal,
  journalFacilityUse,
  posting,
} from "../schema/index.js";

export interface JournalRepo {
  insertPosted(journal: Journal, householdId: string): Promise<void>;
  listPosted(householdId: string): Promise<Journal[]>;
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
      const journalRows = await db
        .select()
        .from(journal)
        .where(and(eq(journal.householdId, householdId), eq(journal.status, "POSTED")));

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
        .select({
          posting,
          accountCurrency: account.currency,
        })
        .from(posting)
        .innerJoin(account, eq(posting.accountId, account.id))
        .where(inArray(posting.journalId, journalIds));

      const facilityRows = await db
        .select()
        .from(journalFacilityUse)
        .where(inArray(journalFacilityUse.journalId, journalIds));

      const postingsByJournal = new Map<string, Array<{ posting: typeof posting.$inferSelect; accountCurrency: string }>>();
      for (const row of postingRows) {
        const list = postingsByJournal.get(row.posting.journalId) ?? [];
        list.push(row);
        postingsByJournal.set(row.posting.journalId, list);
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
    },
  };
}

function toDomainJournal(
  row: typeof journal.$inferSelect,
  postingRows: Array<{ posting: typeof posting.$inferSelect; accountCurrency: string }>,
  facilityRows: Array<typeof journalFacilityUse.$inferSelect>,
  reportingCurrency: string,
): Journal {
  const domainPostings: Posting[] = postingRows.map(({ posting: p, accountCurrency }) => {
    const domainPosting: Posting = {
      accountId: p.accountId,
      amount: money(accountCurrency, p.amountMinor),
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
