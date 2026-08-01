import { bigint, date, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { account } from "./account";

export const statement = pgTable("statement", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  statedBalanceMinor: bigint("stated_balance_minor", { mode: "bigint" }).notNull(),
  statedAsOf: date("stated_as_of").notNull(),
  sourceLabel: text("source_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
