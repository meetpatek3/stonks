import { date, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { importBatch } from "./import_batch";

export const importMatchStateEnum = pgEnum("import_match_state", [
  "NEW",
  "DUPLICATE",
  "CONFLICT",
]);

export const importCandidate = pgTable("import_candidate", {
  id: text("id").primaryKey(),
  importBatchId: uuid("import_batch_id")
    .notNull()
    .references(() => importBatch.id),
  externalNaturalKey: text("external_natural_key").notNull(),
  tradeDate: date("trade_date").notNull(),
  proposedJournal: jsonb("proposed_journal").notNull(),
  matchState: importMatchStateEnum("match_state").notNull(),
  matchedJournalId: text("matched_journal_id"),
});
