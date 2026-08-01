import { bigint, pgEnum, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { journal } from "./journal";

export const facilityUseEnum = pgEnum("facility_use", [
  "INVESTMENT",
  "LENDING",
  "PERSONAL",
  "OTHER",
]);

export const journalFacilityUse = pgTable(
  "journal_facility_use",
  {
    journalId: text("journal_id")
      .notNull()
      .references(() => journal.id),
    use: facilityUseEnum("use").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.journalId, table.use] })],
);
