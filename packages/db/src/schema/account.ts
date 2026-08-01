import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currency } from "./currency";
import { household } from "./household";

export const accountTypeEnum = pgEnum("account_type", [
  "INVESTMENT",
  "CREDIT_FACILITY",
  "RECEIVABLE",
  "CASH",
  "EXTERNAL",
]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => household.id),
  type: accountTypeEnum("type").notNull(),
  currency: text("currency")
    .notNull()
    .references(() => currency.code),
  taxTreatment: text("tax_treatment"),
  name: text("name").notNull(),
  contributionPolicyId: uuid("contribution_policy_id"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});
