import { sql } from "drizzle-orm";
import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { household } from "./household";

export const journalTypeEnum = pgEnum("journal_type", [
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

export const journalStatusEnum = pgEnum("journal_status", ["POSTED", "SUPERSEDED"]);

export const journalSourceEnum = pgEnum("journal_source", [
  "MANUAL",
  "IMPORT",
  "SYSTEM",
]);

export const journal = pgTable(
  "journal",
  {
    id: text("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    type: journalTypeEnum("type").notNull(),
    tradeDate: date("trade_date").notNull(),
    sortKey: integer("sort_key").notNull(),
    memo: text("memo"),
    externalNaturalKey: text("external_natural_key"),
    source: journalSourceEnum("source").notNull(),
    status: journalStatusEnum("status").notNull(),
    supersedesJournalId: text("supersedes_journal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("journal_household_trade_date_sort_key_posted_idx")
      .on(table.householdId, table.tradeDate, table.sortKey)
      .where(sql`${table.status} = 'POSTED'`),
  ],
);
