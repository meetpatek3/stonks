import { date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currency } from "./currency";

export const securityTypeEnum = pgEnum("security_type", [
  "EQUITY",
  "ETF",
  "MUTUAL_FUND",
  "BOND",
  "OTHER",
]);

/**
 * A security is identified by a stable id that is independent of any ticker symbol, so a
 * symbol change, an exchange change, or a cross-listing cannot fork one holding into two
 * positions (and so manufacture a phantom gain). Shared reference data: the identity and
 * trading currency of a security are the same fact for every household, and `posting.security_id`
 * already carries no household scope.
 */
export const security = pgTable("security", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: securityTypeEnum("type").notNull(),
  currency: text("currency")
    .notNull()
    .references(() => currency.code),
});

/**
 * Symbols are attributes of a security over a date range, never its identity. Many symbol rows
 * (renames, cross-listings) map onto one `security`.
 */
export const securitySymbol = pgTable(
  "security_symbol",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: text("security_id")
      .notNull()
      .references(() => security.id),
    symbol: text("symbol").notNull(),
    exchange: text("exchange").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** Null means the symbol is still current. */
    effectiveTo: date("effective_to"),
  },
  (t) => [
    uniqueIndex("security_symbol_symbol_exchange_from_idx").on(
      t.symbol,
      t.exchange,
      t.effectiveFrom,
    ),
    index("security_symbol_security_idx").on(t.securityId),
  ],
);
