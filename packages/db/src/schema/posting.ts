import { bigint, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { account } from "./account";
import { currency } from "./currency";
import { journal } from "./journal";

export const posting = pgTable("posting", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: text("journal_id")
    .notNull()
    .references(() => journal.id),
  accountId: text("account_id")
    .notNull()
    .references(() => account.id),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  quantity: numeric("quantity", { precision: 28, scale: 8 }),
  securityId: text("security_id"),
  tradeCurrency: text("trade_currency").references(() => currency.code),
  reportingAmountMinor: bigint("reporting_amount_minor", { mode: "bigint" }),
  fxRateN: bigint("fx_rate_n", { mode: "bigint" }),
  fxRateD: bigint("fx_rate_d", { mode: "bigint" }),
});
