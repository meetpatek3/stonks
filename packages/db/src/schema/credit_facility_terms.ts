import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { account } from "./account";
import { benchmarkRate } from "./benchmark_rate";

export const dayCountEnum = pgEnum("day_count", [
  "ACT_365",
  "ACT_360",
  "ACT_ACT",
]);

export const postingDayRuleEnum = pgEnum("posting_day_rule", [
  "CALENDAR_DAY",
  "MONTH_END",
]);

export const creditFacilityTerms = pgTable("credit_facility_terms", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  benchmarkId: uuid("benchmark_id")
    .notNull()
    .references(() => benchmarkRate.id),
  spreadBps: integer("spread_bps").notNull(),
  dayCount: dayCountEnum("day_count").notNull(),
  postingDayRule: postingDayRuleEnum("posting_day_rule").notNull(),
  capitalizeInterest: boolean("capitalize_interest").notNull().default(true),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});
