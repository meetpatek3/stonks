import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { currency } from "./currency";

export const costBasisMethodEnum = pgEnum("cost_basis_method", ["ACB", "FIFO"]);

export const household = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportingCurrency: text("reporting_currency")
    .notNull()
    .references(() => currency.code),
  defaultCostBasisMethod: costBasisMethodEnum("default_cost_basis_method")
    .notNull()
    .default("ACB"),
  authPasswordHash: text("auth_password_hash"),
  timezone: text("timezone").notNull().default("America/Toronto"),
});
