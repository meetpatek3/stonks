import {
  bigint,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { currency } from "./currency";
import { household } from "./household";
import { security } from "./security";

/**
 * A closing price for a security on a date is the same fact for everyone, so quotes are shared
 * reference data and carry no household scope. One quote per security/currency/date: a re-fetch
 * of the same day corrects the row in place (it is a restatement of the same external fact,
 * not household-authored history), with `source`/`fetched_at` recording provenance.
 */
export const priceQuote = pgTable(
  "price_quote",
  {
    securityId: text("security_id")
      .notNull()
      .references(() => security.id),
    currency: text("currency")
      .notNull()
      .references(() => currency.code),
    asOf: date("as_of").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  // The composite primary key also serves the "latest quote at or before a date" lookup.
  (t) => [primaryKey({ columns: [t.securityId, t.currency, t.asOf] })],
);

/**
 * A manually entered price. This is one household's judgement, not a shared fact, so overrides
 * are household-scoped. Append-only: a correction is a new row, never an update, so the history
 * of manual prices stays auditable (mirroring the ledger's immutability principle). The latest
 * row per (household, security, as_of) wins.
 */
export const priceOverride = pgTable(
  "price_override",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => household.id),
    securityId: text("security_id")
      .notNull()
      .references(() => security.id),
    asOf: date("as_of").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    note: text("note").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_override_household_security_as_of_idx").on(
      t.householdId,
      t.securityId,
      t.asOf,
    ),
  ],
);
