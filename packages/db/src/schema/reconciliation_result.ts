import { bigint, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { statement } from "./statement";

export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "MATCH",
  "MISMATCH",
]);

export const reconciliationResult = pgTable("reconciliation_result", {
  id: uuid("id").defaultRandom().primaryKey(),
  statementId: text("statement_id")
    .notNull()
    .references(() => statement.id),
  computedBalanceMinor: bigint("computed_balance_minor", { mode: "bigint" }).notNull(),
  statedBalanceMinor: bigint("stated_balance_minor", { mode: "bigint" }).notNull(),
  status: reconciliationStatusEnum("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
