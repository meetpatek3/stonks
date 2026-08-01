import { date, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

export const benchmarkRate = pgTable("benchmark_rate", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
});

export const benchmarkRatePoint = pgTable(
  "benchmark_rate_point",
  {
    benchmarkId: uuid("benchmark_id")
      .notNull()
      .references(() => benchmarkRate.id),
    effectiveDate: date("effective_date").notNull(),
    rateBps: integer("rate_bps").notNull(),
  },
  (t) => [primaryKey({ columns: [t.benchmarkId, t.effectiveDate] })],
);
