import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { household } from "./household";

export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "PREVIEW",
  "COMMITTED",
  "REJECTED",
]);

export const importBatch = pgTable("import_batch", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => household.id),
  status: importBatchStatusEnum("status").notNull(),
  sourceLabel: text("source_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
