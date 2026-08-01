import {
  bigint,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { account } from "./account";

export const interestModelRun = pgTable("interest_model_run", {
  id: uuid("id").defaultRandom().primaryKey(),
  facilityAccountId: text("facility_account_id")
    .notNull()
    .references(() => account.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  modelledMinor: bigint("modelled_minor", { mode: "bigint" }).notNull(),
  actualPostedMinor: bigint("actual_posted_minor", { mode: "bigint" }).notNull(),
  varianceMinor: bigint("variance_minor", { mode: "bigint" }).notNull(),
  modelledByUse: jsonb("modelled_by_use").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
