import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const currency = pgTable("currency", {
  code: text("code").primaryKey(),
  minorUnits: integer("minor_units").notNull(),
  name: text("name").notNull(),
});
